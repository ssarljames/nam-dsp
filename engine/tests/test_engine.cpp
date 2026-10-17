#include "Engine.h"
#include "test_util.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

namespace {

/** Stages a real .nam document and returns its length. */
int32_t stage_example_model(Engine& engine, const char* name) {
    const std::string path = std::string(NAM_EXAMPLE_MODELS_DIR) + "/" + name;
    std::ifstream file(path, std::ios::binary);
    if (!file) {
        testutil::report(__FILE__, __LINE__, "could not open example model: " + path);
        return 0;
    }
    const std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(file)),
                                     std::istreambuf_iterator<char>());
    std::memcpy(engine.modelStaging(), bytes.data(), bytes.size());
    return static_cast<int32_t>(bytes.size());
}

}  // namespace

static void the_param_block_matches_the_typescript_declaration() {
    // src/audio/params.ts PARAM_COUNT must equal this. If you change one,
    // change both — the index mapping is a cross-language contract.
    CHECK(Engine::kParamCount == 56);
    CHECK(Engine::kInputGainIndex == 0);
    CHECK(Engine::kEqBaseIndex == 1);
    CHECK(Engine::kEqLevelIndex == 4);
    CHECK(Engine::kOutputVolumeIndex == 5);
    CHECK(Engine::kGateThresholdIndex == 6);
    CHECK(Engine::kCabLevelIndex == 7);
    CHECK(Engine::kSlotBaseIndex == 8);
}

static void the_param_block_starts_zeroed() {
    Engine engine;
    for (int i = 0; i < Engine::kParamCount; ++i) CHECK(engine.params()[i] == 0.0f);
}

static void a_zeroed_param_block_is_unity_gain_and_flat_eq() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);

    // All params are 0 dB: two unity gains and a flat tone stack.
    for (int block = 0; block < 100; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.5f;
        engine.process(Engine::kMaxBlockSize);
    }

    for (int i = 0; i < Engine::kMaxBlockSize; ++i) {
        CHECK_CLOSE(engine.buffer()[i], 0.5f, 1e-4);
    }
}

static void the_output_volume_param_attenuates() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.params()[Engine::kOutputVolumeIndex] = -6.0f;

    for (int block = 0; block < 200; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 1.0f;
        engine.process(Engine::kMaxBlockSize);
    }

    CHECK_CLOSE(engine.buffer()[Engine::kMaxBlockSize - 1], 0.501187, 1e-3);
}

static void the_input_gain_param_multiplies_before_the_eq() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.params()[Engine::kInputGainIndex] = 6.0f;

    for (int block = 0; block < 200; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.25f;
        engine.process(Engine::kMaxBlockSize);
    }

    CHECK_CLOSE(engine.buffer()[Engine::kMaxBlockSize - 1], 0.25 * 1.995262, 1e-3);
}

static void the_eq_params_are_wired_to_the_right_bands() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.params()[Engine::kEqBaseIndex + 0] = 12.0f;  // bass

    constexpr double kPi = 3.14159265358979323846;
    double phase = 0.0;
    const double increment = 2.0 * kPi * 20.0 / 48000.0;
    float peak = 0.0f;

    for (int block = 0; block < 300; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) {
            engine.buffer()[i] = static_cast<float>(std::sin(phase));
            phase += increment;
        }
        engine.process(Engine::kMaxBlockSize);
        if (block > 250) {
            for (int i = 0; i < Engine::kMaxBlockSize; ++i) {
                const float a = std::fabs(engine.buffer()[i]);
                if (a > peak) peak = a;
            }
        }
    }

    CHECK(peak > 3.2f);   // ~+12 dB at 20 Hz through the low shelf
    CHECK(peak < 4.1f);
}

static void a_short_block_only_touches_that_many_frames() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);

    for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 1.0f;
    engine.buffer()[64] = 99.0f;

    engine.process(64);

    // Frame 64 is outside the processed range and must be untouched.
    CHECK(engine.buffer()[64] == 99.0f);
}

static void an_oversized_block_is_clamped_rather_than_overrunning() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 1.0f;

    // Must not read or write past the fixed buffer.
    engine.process(Engine::kMaxBlockSize * 4);

    for (int i = 0; i < Engine::kMaxBlockSize; ++i) CHECK_FINITE(engine.buffer()[i]);
}

static void the_nam_pool_fits_inside_the_slot_pool() {
    CHECK(Engine::kNamCount >= 1);
    CHECK(Engine::kNamCount * Engine::kParamsPerSlot <=
          Engine::kParamCount - Engine::kSlotBaseIndex);
}

static void the_staging_buffer_is_addressable_and_the_right_size() {
    Engine engine;
    CHECK(engine.modelStaging() != nullptr);
    CHECK(Engine::kMaxModelBytes == 8 * 1024 * 1024);

    // Writing both ends proves the region is really there.
    engine.modelStaging()[0] = 0x11;
    engine.modelStaging()[Engine::kMaxModelBytes - 1] = 0x22;
    CHECK(engine.modelStaging()[0] == 0x11);
    CHECK(engine.modelStaging()[Engine::kMaxModelBytes - 1] == 0x22);
}

static void a_nam_stage_starts_disabled_with_no_model() {
    Engine engine;
    CHECK(!engine.nam(0).hasModel());
    // Matches the panel's default of bypassed, so the two cannot disagree
    // before the UI has pushed anything.
    CHECK(!engine.nam(0).enabled);
}

static void loading_a_model_records_it_on_the_named_slot() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    const int32_t length = stage_example_model(engine, "lstm.nam");

    CHECK(engine.loadNamModel(0, length));
    CHECK(engine.nam(0).hasModel());
    CHECK(engine.nam(0).modelByteLength() == length);
}

static void staged_bytes_that_are_not_a_model_are_rejected() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    std::memset(engine.modelStaging(), 0xAB, 2048);

    CHECK(!engine.loadNamModel(0, 2048));
    CHECK(!engine.nam(0).hasModel());
}

static void loading_an_out_of_range_slot_is_rejected() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    const int32_t length = stage_example_model(engine, "lstm.nam");
    CHECK(!engine.loadNamModel(-1, length));
    CHECK(!engine.loadNamModel(Engine::kNamCount, length));
    CHECK(!engine.nam(0).hasModel());
}

static void an_oversized_load_is_rejected_at_the_engine_boundary() {
    Engine engine;
    CHECK(!engine.loadNamModel(0, Engine::kMaxModelBytes + 1));
    CHECK(!engine.nam(0).hasModel());
}

static void enabling_a_nam_stage_is_slot_addressed() {
    Engine engine;
    engine.setNamEnabled(0, true);
    CHECK(engine.nam(0).enabled);

    engine.setNamEnabled(0, false);
    CHECK(!engine.nam(0).enabled);

    // Out of range is ignored rather than corrupting a neighbour.
    engine.setNamEnabled(Engine::kNamCount, true);
    CHECK(!engine.nam(0).enabled);
}

static void an_enabled_nam_stage_does_not_alter_the_tone_stack() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setNamEnabled(0, true);

    // Same signal and settle as a_zeroed_param_block_is_unity_gain_and_flat_eq:
    // inserting the pass-through stage must not change the result.
    for (int block = 0; block < 100; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.5f;
        engine.process(Engine::kMaxBlockSize);
    }

    for (int i = 0; i < Engine::kMaxBlockSize; ++i) {
        CHECK_CLOSE(engine.buffer()[i], 0.5f, 1e-4);
    }
}

static void nam_accessor_returns_the_right_stage_for_every_valid_slot() {
    // nam()'s out-of-range path (assert + clamp — see Engine::nam) can't be
    // exercised here: the host test build leaves NDEBUG unset, so an
    // out-of-range call would trip the assert and abort the test process
    // rather than exercise the clamp. What IS testable, and what this proves,
    // is the documented contract for every in-range slot: each index reaches
    // its own distinct stage, not a neighbour's.
    Engine engine;
    for (int32_t slot = 0; slot < Engine::kNamCount; ++slot) {
        engine.setNamEnabled(slot, true);
        CHECK(engine.nam(slot).enabled);
    }
}

static void the_eq_level_param_scales_the_output() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.params()[Engine::kEqLevelIndex] = 6.0f;

    for (int block = 0; block < 200; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.25f;
        engine.process(Engine::kMaxBlockSize);
    }

    CHECK_CLOSE(engine.buffer()[Engine::kMaxBlockSize - 1], 0.25 * 1.995262, 1e-3);
}

static void the_chain_runs_gate_input_gain_drive_nam_cab_chorus_tremolo_delay_reverb_eq_output() {
    Engine engine;
    const ProcessorChain& chain = engine.chainForTest();

    CHECK(chain.size() == 10 + Engine::kNamCount);
    CHECK(chain.at(0) == static_cast<const Processor*>(&engine.gate()));
    CHECK(chain.paramOffsetAt(0) == Engine::kGateThresholdIndex);
    CHECK(chain.paramOffsetAt(1) == Engine::kInputGainIndex);
    // The PRE effect: after the input gain, before the amp model.
    CHECK(chain.at(2) == static_cast<const Processor*>(&engine.drive()));
    CHECK(chain.paramOffsetAt(2) == Engine::kDriveParamIndex);
    for (int32_t i = 0; i < Engine::kNamCount; ++i) {
        CHECK(chain.at(3 + i) == static_cast<const Processor*>(&engine.nam(i)));
        CHECK(chain.paramOffsetAt(3 + i) == Engine::kSlotBaseIndex + i * Engine::kParamsPerSlot);
    }
    CHECK(chain.at(3 + Engine::kNamCount) == static_cast<const Processor*>(&engine.cab()));
    CHECK(chain.paramOffsetAt(3 + Engine::kNamCount) == Engine::kCabLevelIndex);
    // The four POST effects: chorus, tremolo, delay, reverb by default.
    CHECK(Engine::kPostEntryIndex == 4 + Engine::kNamCount);
    CHECK(Engine::kPostCount == 4);
    CHECK(chain.at(Engine::kPostEntryIndex) == static_cast<const Processor*>(&engine.chorus()));
    CHECK(chain.paramOffsetAt(Engine::kPostEntryIndex) == Engine::kChorusParamIndex);
    CHECK(chain.at(Engine::kPostEntryIndex + 1) == static_cast<const Processor*>(&engine.tremolo()));
    CHECK(chain.paramOffsetAt(Engine::kPostEntryIndex + 1) == Engine::kTremoloParamIndex);
    CHECK(chain.at(Engine::kPostEntryIndex + 2) == static_cast<const Processor*>(&engine.delay()));
    CHECK(chain.paramOffsetAt(Engine::kPostEntryIndex + 2) == Engine::kDelayParamIndex);
    CHECK(chain.at(Engine::kPostEntryIndex + 3) == static_cast<const Processor*>(&engine.reverb()));
    CHECK(chain.paramOffsetAt(Engine::kPostEntryIndex + 3) == Engine::kReverbParamIndex);
    CHECK(chain.at(8 + Engine::kNamCount) == static_cast<const Processor*>(&engine.eq()));
    CHECK(chain.paramOffsetAt(8 + Engine::kNamCount) == Engine::kEqBaseIndex);
    CHECK(chain.paramOffsetAt(9 + Engine::kNamCount) == Engine::kOutputVolumeIndex);
    CHECK(engine.postOrder()[0] == Engine::Stage::Chorus);
    CHECK(engine.postOrder()[1] == Engine::Stage::Tremolo);
    CHECK(engine.postOrder()[2] == Engine::Stage::Delay);
    CHECK(engine.postOrder()[3] == Engine::Stage::Reverb);
}

static void the_drive_slot_sits_clear_of_the_other_slots() {
    CHECK(Engine::kDriveSlot == Engine::kNamCount + 2);
    CHECK(Engine::kDriveSlot != Engine::kDelaySlot);
    CHECK(Engine::kDriveSlot != Engine::kChorusSlot);
    CHECK(Engine::kDriveParamIndex == 26);
    // The worklet's STAGE_IDS maps 'drive' onto this.
    CHECK(static_cast<int32_t>(Engine::Stage::Drive) == 5);
}

static void the_drive_starts_disabled() {
    Engine engine;
    CHECK(!engine.drive().enabled);
}

static void the_drive_stage_is_enabled_independently() {
    Engine engine;
    engine.setStageEnabled(Engine::Stage::Drive, true);
    CHECK(engine.drive().enabled);
    CHECK(!engine.chorus().enabled);
    CHECK(!engine.delay().enabled);
    CHECK(!engine.cab().enabled);
    CHECK(!engine.gate().enabled);
    engine.setStageEnabled(Engine::Stage::Drive, false);
    CHECK(!engine.drive().enabled);
}

/** A 1 kHz sine at 0.1 through the engine, `blocks` quanta; returns the last quarter second. */
static std::vector<float> run_sine(Engine& engine, int blocks) {
    std::vector<float> out;
    for (int block = 0; block < blocks; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) {
            const double n = static_cast<double>(block * Engine::kMaxBlockSize + i);
            engine.buffer()[i] = static_cast<float>(0.1 * std::sin(2.0 * 3.141592653589793 * 1000.0 * n / 48000.0));
        }
        engine.process(Engine::kMaxBlockSize);
        if (block >= blocks * 3 / 4) out.insert(out.end(), engine.buffer(), engine.buffer() + Engine::kMaxBlockSize);
    }
    return out;
}

static void an_enabled_drive_reads_its_params_from_the_slot_pool() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Eq, false);
    engine.params()[Engine::kDriveParamIndex + 0] = 0.0f;    // level, dB
    engine.params()[Engine::kDriveParamIndex + 1] = 48.0f;   // gain, dB
    engine.params()[Engine::kDriveParamIndex + 2] = 100.0f;  // tone, percent
    engine.params()[Engine::kDriveParamIndex + 3] = 1.0f;    // HARD
    engine.setStageEnabled(Engine::Stage::Drive, true);

    const std::vector<float> out = run_sine(engine, 400);
    double peak = 0.0;
    double sumSquares = 0.0;
    for (float v : out) {
        peak = std::fmax(peak, std::fabs(v));
        sumSquares += static_cast<double>(v) * v;
    }
    const double crest = peak / std::sqrt(sumSquares / static_cast<double>(out.size()));
    // A sine's crest factor is 1.414; hard-clipped at +48 dB it is nearly square.
    CHECK(crest < 1.3);
}

static void a_disabled_drive_does_not_touch_the_signal() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Eq, false);
    engine.params()[Engine::kDriveParamIndex + 1] = 48.0f;
    engine.params()[Engine::kDriveParamIndex + 3] = 1.0f;

    for (int block = 0; block < 10; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.5f;
        engine.process(Engine::kMaxBlockSize);
    }
    CHECK_CLOSE(engine.buffer()[Engine::kMaxBlockSize - 1], 0.5, 1e-6);
}

static void reengaging_a_bypassed_drive_resets_it() {
    auto first_block_after_enable = [](bool bypassFirst) {
        Engine engine;
        engine.prepare(48000.0, Engine::kMaxBlockSize);
        engine.setStageEnabled(Engine::Stage::Eq, false);
        engine.params()[Engine::kDriveParamIndex + 1] = 27.0f;
        engine.params()[Engine::kDriveParamIndex + 2] = 50.0f;
        engine.setStageEnabled(Engine::Stage::Drive, true);
        if (bypassFirst) {
            for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.9f;
            engine.process(Engine::kMaxBlockSize);
            engine.setStageEnabled(Engine::Stage::Drive, false);
            engine.setStageEnabled(Engine::Stage::Drive, true);
        }
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.0f;
        engine.process(Engine::kMaxBlockSize);
        return std::vector<float>(engine.buffer(), engine.buffer() + Engine::kMaxBlockSize);
    };
    // A drive that merely flipped `enabled` would still be ringing from the 0.9 block.
    const std::vector<float> fresh = first_block_after_enable(false);
    const std::vector<float> reengaged = first_block_after_enable(true);
    for (int i = 0; i < Engine::kMaxBlockSize; ++i) CHECK(fresh[i] == reengaged[i]);
}

static void reengaging_an_already_enabled_drive_does_not_reset_it() {
    auto first_block_after_enable = [](bool reengageFirst) {
        Engine engine;
        engine.prepare(48000.0, Engine::kMaxBlockSize);
        engine.setStageEnabled(Engine::Stage::Eq, false);
        engine.params()[Engine::kDriveParamIndex + 1] = 27.0f;
        engine.params()[Engine::kDriveParamIndex + 2] = 50.0f;
        engine.setStageEnabled(Engine::Stage::Drive, true);
        if (reengageFirst) {
            for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.9f;
            engine.process(Engine::kMaxBlockSize);
            engine.setStageEnabled(Engine::Stage::Drive, true);
        }
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.0f;
        engine.process(Engine::kMaxBlockSize);
        return std::vector<float>(engine.buffer(), engine.buffer() + Engine::kMaxBlockSize);
    };
    // Re-enabling an already-enabled drive must not reset it: the tighten
    // filter's ringing state from the 0.9 block should still be audible in
    // the following quiet block, so it must NOT match a freshly enabled
    // drive fed straight into silence.
    const std::vector<float> fresh = first_block_after_enable(false);
    const std::vector<float> reengaged = first_block_after_enable(true);
    bool anyDifferent = false;
    for (int i = 0; i < Engine::kMaxBlockSize; ++i) {
        if (fresh[i] != reengaged[i]) { anyDifferent = true; break; }
    }
    CHECK(anyDifferent);
}

static void set_post_order_leaves_the_drive_in_place() {
    Engine engine;
    const ProcessorChain& chain = engine.chainForTest();
    engine.setStageEnabled(Engine::Stage::Drive, true);
    engine.setPostOrder(Engine::Stage::Reverb, Engine::Stage::Delay, Engine::Stage::Chorus, Engine::Stage::Tremolo);
    CHECK(chain.at(2) == static_cast<const Processor*>(&engine.drive()));
    CHECK(chain.at(Engine::kPostEntryIndex) == static_cast<const Processor*>(&engine.reverb()));
    CHECK(chain.at(Engine::kPostEntryIndex + 1) == static_cast<const Processor*>(&engine.delay()));
    CHECK(chain.at(Engine::kPostEntryIndex + 2) == static_cast<const Processor*>(&engine.chorus()));
    CHECK(chain.at(Engine::kPostEntryIndex + 3) == static_cast<const Processor*>(&engine.tremolo()));
    CHECK(engine.drive().enabled);
}

static void the_eq_starts_enabled_and_can_be_bypassed() {
    Engine engine;
    CHECK(engine.eq().enabled);

    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.params()[Engine::kEqBaseIndex + 0] = 12.0f;  // a bass boost bypass must remove
    engine.setStageEnabled(Engine::Stage::Eq, false);
    CHECK(!engine.eq().enabled);

    // Same signal as the_eq_params_are_wired_to_the_right_bands, where the EQ
    // lifts the peak to ~3.2-4.1. Bypassed, it must stay at the input's 1.0.
    constexpr double kPi = 3.14159265358979323846;
    double phase = 0.0;
    const double increment = 2.0 * kPi * 20.0 / 48000.0;
    float peak = 0.0f;
    for (int block = 0; block < 300; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) {
            engine.buffer()[i] = static_cast<float>(std::sin(phase));
            phase += increment;
        }
        engine.process(Engine::kMaxBlockSize);
        if (block > 250) {
            for (int i = 0; i < Engine::kMaxBlockSize; ++i) {
                const float a = std::fabs(engine.buffer()[i]);
                if (a > peak) peak = a;
            }
        }
    }
    CHECK(peak < 1.05f);
}

static void an_engaged_nam_stage_applies_its_level_from_the_slot_pool() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setNamEnabled(0, true);
    engine.params()[Engine::kSlotBaseIndex] = 6.0f;  // slot0_p0: NAM stage 0's level

    for (int block = 0; block < 200; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.25f;
        engine.process(Engine::kMaxBlockSize);
    }

    CHECK_CLOSE(engine.buffer()[Engine::kMaxBlockSize - 1], 0.25 * 1.995262, 1e-3);
}

static void a_bypassed_nam_stage_ignores_its_level() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setNamEnabled(0, false);
    engine.params()[Engine::kSlotBaseIndex] = 6.0f;

    for (int block = 0; block < 200; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.25f;
        engine.process(Engine::kMaxBlockSize);
    }

    // Bypassed means not run at all, so its level cannot apply.
    CHECK_CLOSE(engine.buffer()[Engine::kMaxBlockSize - 1], 0.25, 1e-4);
}

static void the_gate_starts_disabled() {
    Engine engine;
    // Matches the panel's default of bypassed, so the two cannot disagree
    // before the UI has pushed anything.
    CHECK(!engine.gate().enabled);
}

static void stages_are_enabled_independently() {
    Engine engine;
    engine.setStageEnabled(Engine::Stage::Gate, true);
    CHECK(engine.gate().enabled);
    CHECK(engine.eq().enabled);

    engine.setStageEnabled(Engine::Stage::Eq, false);
    CHECK(engine.gate().enabled);
    CHECK(!engine.eq().enabled);

    engine.setStageEnabled(Engine::Stage::Gate, false);
    CHECK(!engine.gate().enabled);
    CHECK(!engine.eq().enabled);

    // An id this build does not know changes nothing.
    engine.setStageEnabled(static_cast<Engine::Stage>(99), true);
    CHECK(!engine.gate().enabled);
    CHECK(!engine.eq().enabled);
}

static void the_gate_reads_its_threshold_from_the_param_block() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Gate, true);
    // −30 dB DC. With the threshold at −40 dB the gate stays open; were the
    // gate reading the zeroed default (0 dB) instead, it would close.
    engine.params()[Engine::kGateThresholdIndex] = -40.0f;
    const float in = 0.031623f;

    for (int block = 0; block < 1000; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = in;
        engine.process(Engine::kMaxBlockSize);
    }

    CHECK(engine.gate().isOpen());
    CHECK_CLOSE(engine.buffer()[Engine::kMaxBlockSize - 1], in, 1e-4);
}

static void the_gate_hears_the_signal_before_input_gain() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Gate, true);
    engine.params()[Engine::kGateThresholdIndex] = -40.0f;
    engine.params()[Engine::kInputGainIndex] = 24.0f;
    // −50 dB DC: below the gate's −46 dB close point. After +24 dB of input
    // gain it would be −26 dB and hold the gate open — so a closed gate proves
    // the gate runs first, where the input meter taps (spec §2).
    const float in = 0.0031623f;

    for (int block = 0; block < 1000; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = in;
        engine.process(Engine::kMaxBlockSize);
    }

    CHECK(!engine.gate().isOpen());
    CHECK(std::fabs(engine.buffer()[Engine::kMaxBlockSize - 1]) < in * 15.85f * 1e-3f);
}

static void reengaging_a_bypassed_gate_resets_it() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Gate, true);
    engine.params()[Engine::kGateThresholdIndex] = -40.0f;

    // ~2 s of silence: enough for the gate to close under its own hold and hysteresis.
    const int blocks = static_cast<int>(2.0 * 48000.0 / Engine::kMaxBlockSize) + 1;
    for (int block = 0; block < blocks; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.0f;
        engine.process(Engine::kMaxBlockSize);
    }
    CHECK(!engine.gate().isOpen());

    engine.setStageEnabled(Engine::Stage::Gate, false);
    engine.setStageEnabled(Engine::Stage::Gate, true);

    // Everything else is at 0 dB (unity), so a freshly reset, fully open gate
    // must pass the very first sample of the next block untouched. A gate
    // that merely flipped `enabled` would still be at the floor here.
    for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.1f;
    engine.process(Engine::kMaxBlockSize);
    CHECK_CLOSE(engine.buffer()[0], 0.1, 1e-6);
}

static void reengaging_an_already_enabled_gate_does_not_reopen_it() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Gate, true);
    engine.params()[Engine::kGateThresholdIndex] = -40.0f;

    const int blocks = static_cast<int>(2.0 * 48000.0 / Engine::kMaxBlockSize) + 1;
    for (int block = 0; block < blocks; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.0f;
        engine.process(Engine::kMaxBlockSize);
    }
    CHECK(!engine.gate().isOpen());

    // Re-sending true to an already-enabled gate must not reopen a
    // legitimately closed gate.
    engine.setStageEnabled(Engine::Stage::Gate, true);
    CHECK(!engine.gate().isOpen());
}

static void the_cab_starts_disabled_with_no_ir() {
    Engine engine;
    CHECK(!engine.cab().enabled);
    CHECK(engine.cab().length() == 0);
}

static void the_cab_stage_is_enabled_independently() {
    Engine engine;
    engine.setStageEnabled(Engine::Stage::Cab, true);
    CHECK(engine.cab().enabled);
    CHECK(!engine.gate().enabled);
    CHECK(engine.eq().enabled);

    engine.setStageEnabled(Engine::Stage::Eq, false);
    CHECK(engine.cab().enabled);

    engine.setStageEnabled(Engine::Stage::Cab, false);
    CHECK(!engine.cab().enabled);
    CHECK(!engine.eq().enabled);
}

static void an_oversized_cab_ir_is_rejected_at_the_engine_boundary() {
    Engine engine;
    CHECK(!engine.loadCabIr(Engine::kMaxCabTaps + 1));
    CHECK(engine.cab().length() == 0);
}

static void the_cab_convolves_and_reads_its_level_from_the_param_block() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Eq, false);  // isolate the cab's contribution
    engine.setStageEnabled(Engine::Stage::Cab, true);

    engine.cabIrStaging()[0] = 0.5f;
    CHECK(engine.loadCabIr(1));
    engine.params()[Engine::kCabLevelIndex] = 6.0f;

    for (int block = 0; block < 400; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.5f;
        engine.process(Engine::kMaxBlockSize);
    }

    // 0.5 x a single 0.5 tap x +6 dB. Were the cab reading the zeroed default
    // instead, this would be 0.25.
    CHECK_CLOSE(engine.buffer()[Engine::kMaxBlockSize - 1], 0.25 * 1.995262, 1e-3);
}

static void a_disabled_cab_does_not_touch_the_signal() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Eq, false);

    engine.cabIrStaging()[0] = 0.5f;
    CHECK(engine.loadCabIr(1));

    for (int block = 0; block < 10; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.5f;
        engine.process(Engine::kMaxBlockSize);
    }
    CHECK_CLOSE(engine.buffer()[Engine::kMaxBlockSize - 1], 0.5, 1e-6);
}

static void reengaging_a_bypassed_cab_clears_its_history() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Eq, false);
    engine.setStageEnabled(Engine::Stage::Cab, true);

    engine.cabIrStaging()[3] = 1.0f;  // a delay of three samples
    CHECK(engine.loadCabIr(4));

    // An impulse at n = 1 of a two-sample block: it would emerge at n = 4.
    engine.buffer()[0] = 0.0f;
    engine.buffer()[1] = 1.0f;
    engine.process(2);

    engine.setStageEnabled(Engine::Stage::Cab, false);
    engine.setStageEnabled(Engine::Stage::Cab, true);

    for (int i = 0; i < 4; ++i) engine.buffer()[i] = 0.0f;
    engine.process(4);
    // A cab that merely flipped `enabled` would still hold the impulse and
    // put 1.0 at index 2.
    for (int i = 0; i < 4; ++i) CHECK_CLOSE(engine.buffer()[i], 0.0, 1e-6);
}

static void the_delay_slot_sits_clear_of_the_nam_slots() {
    CHECK(Engine::kDelaySlot == Engine::kNamCount);
    CHECK(Engine::kDelayParamIndex == Engine::kSlotBaseIndex + Engine::kNamCount * Engine::kParamsPerSlot);
    // src/audio/params.ts: PARAM_INDEX.slotBase + DELAY_SLOT * PARAMS_PER_SLOT.
    CHECK(Engine::kDelayParamIndex == 14);
}

static void the_delay_starts_disabled() {
    Engine engine;
    CHECK(!engine.delay().enabled);
}

static void the_delay_stage_is_enabled_independently() {
    Engine engine;
    engine.setStageEnabled(Engine::Stage::Delay, true);
    CHECK(engine.delay().enabled);
    CHECK(!engine.gate().enabled);
    CHECK(!engine.cab().enabled);
    CHECK(engine.eq().enabled);

    engine.setStageEnabled(Engine::Stage::Delay, false);
    CHECK(!engine.delay().enabled);
}

static void an_enabled_delay_reads_its_params_from_the_slot_pool() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Eq, false);
    engine.params()[Engine::kDelayParamIndex + 0] = 100.0f;  // level, percent
    engine.params()[Engine::kDelayParamIndex + 1] = 40.0f;   // time, ms = 1920 samples, well above the 20 ms clamp
    engine.params()[Engine::kDelayParamIndex + 2] = 0.0f;    // feedback, percent
    engine.setStageEnabled(Engine::Stage::Delay, true);

    std::vector<float> out;
    for (int block = 0; block < 17; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) {
            engine.buffer()[i] = (block == 0 && i == 0) ? 1.0f : 0.0f;
        }
        engine.process(Engine::kMaxBlockSize);
        out.insert(out.end(), engine.buffer(), engine.buffer() + Engine::kMaxBlockSize);
    }

    CHECK_CLOSE(out[0], 1.0, 1e-6);  // dry
    CHECK_CLOSE(out[1920], 1.0, 1e-6);  // the repeat, exactly at 40 ms
    CHECK_CLOSE(out[960], 0.0, 1e-6);   // not at the 20 ms clamp: time was read from p1
}

static void a_disabled_delay_does_not_touch_the_signal() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Eq, false);
    engine.params()[Engine::kDelayParamIndex + 0] = 100.0f;
    engine.params()[Engine::kDelayParamIndex + 1] = 20.0f;

    for (int block = 0; block < 10; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.5f;
        engine.process(Engine::kMaxBlockSize);
    }
    CHECK_CLOSE(engine.buffer()[Engine::kMaxBlockSize - 1], 0.5, 1e-6);
}

static void reengaging_a_bypassed_delay_clears_its_line() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Eq, false);
    engine.params()[Engine::kDelayParamIndex + 0] = 100.0f;
    engine.params()[Engine::kDelayParamIndex + 1] = 20.0f;  // 960 samples
    engine.params()[Engine::kDelayParamIndex + 2] = 0.0f;
    engine.setStageEnabled(Engine::Stage::Delay, true);

    // An impulse in the first block; its repeat is due 960 samples later.
    for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = (i == 0) ? 1.0f : 0.0f;
    engine.process(Engine::kMaxBlockSize);

    engine.setStageEnabled(Engine::Stage::Delay, false);
    engine.setStageEnabled(Engine::Stage::Delay, true);

    // A delay that merely flipped `enabled` would still hold the impulse and
    // put it out 832 samples after re-enabling; ten quiet blocks (1280) cover that.
    for (int block = 0; block < 10; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.0f;
        engine.process(Engine::kMaxBlockSize);
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) CHECK_CLOSE(engine.buffer()[i], 0.0, 1e-6);
    }
}

static void reengaging_an_already_enabled_delay_does_not_reset_it() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Eq, false);
    engine.params()[Engine::kDelayParamIndex + 0] = 100.0f;
    engine.params()[Engine::kDelayParamIndex + 1] = 40.0f;  // 1920 samples
    engine.params()[Engine::kDelayParamIndex + 2] = 0.0f;
    engine.setStageEnabled(Engine::Stage::Delay, true);

    for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = (i == 0) ? 1.0f : 0.0f;
    engine.process(Engine::kMaxBlockSize);

    // Re-sending true to an already-enabled delay must not clear its line.
    engine.setStageEnabled(Engine::Stage::Delay, true);

    float peak = 0.0f;
    for (int block = 0; block < 20; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.0f;
        engine.process(Engine::kMaxBlockSize);
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) peak = std::fmax(peak, std::fabs(engine.buffer()[i]));
    }
    CHECK(peak > 0.9f);
}

static void the_chorus_slot_sits_clear_of_the_nam_and_delay_slots() {
    CHECK(Engine::kChorusSlot == Engine::kNamCount + 1);
    CHECK(Engine::kChorusSlot != Engine::kDelaySlot);
    // src/audio/params.ts: PARAM_INDEX.slotBase + CHORUS_SLOT * PARAMS_PER_SLOT.
    CHECK(Engine::kChorusParamIndex == 20);
    // The worklet's STAGE_IDS maps 'chorus' onto this.
    CHECK(static_cast<int32_t>(Engine::Stage::Chorus) == 4);
}

static void the_chorus_starts_disabled() {
    Engine engine;
    CHECK(!engine.chorus().enabled);
}

static void the_chorus_stage_is_enabled_independently() {
    Engine engine;
    engine.setStageEnabled(Engine::Stage::Chorus, true);
    CHECK(engine.chorus().enabled);
    CHECK(!engine.delay().enabled);
    CHECK(!engine.gate().enabled);
    CHECK(!engine.cab().enabled);
    CHECK(engine.eq().enabled);

    engine.setStageEnabled(Engine::Stage::Chorus, false);
    CHECK(!engine.chorus().enabled);
}

static void an_enabled_chorus_reads_its_params_from_the_slot_pool() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Eq, false);
    // Three different values, none a default or a clamp limit, so a param read
    // from the wrong index cannot pass.
    engine.params()[Engine::kChorusParamIndex + 0] = 70.0f;  // level, percent
    engine.params()[Engine::kChorusParamIndex + 1] = 2.0f;   // rate, Hz: one sweep per 24000 samples
    engine.params()[Engine::kChorusParamIndex + 2] = 50.0f;  // depth, percent: +-3 ms = +-144 samples
    engine.setStageEnabled(Engine::Stage::Chorus, true);

    // A ramp in (x = n / 48000): the swept copy of a straight line is the line
    // shifted by the delay, so the delay can be read back at every sample.
    std::vector<double> delay;
    for (int block = 0; block < 150; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) {
            engine.buffer()[i] = static_cast<float>((block * Engine::kMaxBlockSize + i) / 48000.0);
        }
        engine.process(Engine::kMaxBlockSize);
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) {
            const int n = block * Engine::kMaxBlockSize + i;
            const double in = static_cast<double>(static_cast<float>(n / 48000.0));
            const double wet = (static_cast<double>(engine.buffer()[i]) - in) / 0.7;
            delay.push_back(static_cast<double>(n) - wet * 48000.0);
        }
    }

    // 12 ms + 0.5 x 6 ms x sin: 720 samples a quarter sweep in, 432 at three quarters.
    CHECK_CLOSE(delay[6000], 720.0, 1.0);
    CHECK_CLOSE(delay[18000], 432.0, 1.0);
}

static void a_disabled_chorus_does_not_touch_the_signal() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Eq, false);
    engine.params()[Engine::kChorusParamIndex + 0] = 100.0f;
    engine.params()[Engine::kChorusParamIndex + 1] = 2.0f;
    engine.params()[Engine::kChorusParamIndex + 2] = 100.0f;

    for (int block = 0; block < 10; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.5f;
        engine.process(Engine::kMaxBlockSize);
    }
    CHECK_CLOSE(engine.buffer()[Engine::kMaxBlockSize - 1], 0.5, 1e-6);
}

static void reengaging_a_bypassed_chorus_clears_its_line() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Eq, false);
    engine.params()[Engine::kChorusParamIndex + 0] = 100.0f;
    engine.params()[Engine::kChorusParamIndex + 1] = 0.8f;
    engine.params()[Engine::kChorusParamIndex + 2] = 0.0f;  // a fixed 12 ms, 576 samples
    engine.setStageEnabled(Engine::Stage::Chorus, true);

    for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = (i == 0) ? 1.0f : 0.0f;
    engine.process(Engine::kMaxBlockSize);

    engine.setStageEnabled(Engine::Stage::Chorus, false);
    engine.setStageEnabled(Engine::Stage::Chorus, true);

    // A chorus that merely flipped `enabled` would put the copy out 448
    // samples after re-enabling; ten quiet blocks (1280) cover that.
    for (int block = 0; block < 10; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.0f;
        engine.process(Engine::kMaxBlockSize);
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) CHECK_CLOSE(engine.buffer()[i], 0.0, 1e-6);
    }
}

static void reengaging_an_already_enabled_chorus_does_not_reset_it() {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Eq, false);
    engine.params()[Engine::kChorusParamIndex + 0] = 100.0f;
    engine.params()[Engine::kChorusParamIndex + 1] = 0.8f;
    engine.params()[Engine::kChorusParamIndex + 2] = 0.0f;
    engine.setStageEnabled(Engine::Stage::Chorus, true);

    for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = (i == 0) ? 1.0f : 0.0f;
    engine.process(Engine::kMaxBlockSize);

    engine.setStageEnabled(Engine::Stage::Chorus, true);

    float peak = 0.0f;
    for (int block = 0; block < 10; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.0f;
        engine.process(Engine::kMaxBlockSize);
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) peak = std::fmax(peak, std::fabs(engine.buffer()[i]));
    }
    CHECK(peak > 0.9f);
}

/** The processor the engine owns for a POST stage. */
static const Processor* post_processor(const Engine& engine, Engine::Stage stage) {
    switch (stage) {
        case Engine::Stage::Chorus: return &engine.chorus();
        case Engine::Stage::Delay: return &engine.delay();
        case Engine::Stage::Tremolo: return &engine.tremolo();
        default: return &engine.reverb();
    }
}

static int post_param_offset(Engine::Stage stage) {
    switch (stage) {
        case Engine::Stage::Chorus: return Engine::kChorusParamIndex;
        case Engine::Stage::Delay: return Engine::kDelayParamIndex;
        case Engine::Stage::Tremolo: return Engine::kTremoloParamIndex;
        default: return Engine::kReverbParamIndex;
    }
}

static void set_post_order_reaches_every_permutation_and_moves_only_the_post_effects() {
    using S = Engine::Stage;
    // All 24 orders of the four, generated in Stage-number order.
    std::vector<std::array<S, 4>> orders;
    std::array<S, 4> order = {S::Delay, S::Chorus, S::Reverb, S::Tremolo};
    do {
        orders.push_back(order);
    } while (std::next_permutation(order.begin(), order.end()));
    CHECK(orders.size() == 24);
    Engine engine;
    const ProcessorChain& chain = engine.chainForTest();
    std::vector<const Processor*> before;
    std::vector<int> offsets;
    for (int i = 0; i < chain.size(); ++i) {
        before.push_back(chain.at(i));
        offsets.push_back(chain.paramOffsetAt(i));
    }
    engine.setStageEnabled(Engine::Stage::Delay, true);

    // Every order from every other, so each kind of rearrangement is exercised.
    for (const auto& from : orders) {
        for (const auto& to : orders) {
            engine.setPostOrder(from[0], from[1], from[2], from[3]);
            engine.setPostOrder(to[0], to[1], to[2], to[3]);
            const int post = Engine::kPostEntryIndex;
            for (int k = 0; k < 4; ++k) {
                const size_t kk = static_cast<size_t>(k);
                CHECK(engine.postOrder()[kk] == to[kk]);
                CHECK(chain.at(post + k) == post_processor(engine, to[kk]));
                // Each processor still reads its own slice of the param block.
                CHECK(chain.paramOffsetAt(post + k) == post_param_offset(to[kk]));
            }
            for (int i = 0; i < chain.size(); ++i) {
                if (i >= post && i < post + 4) continue;
                CHECK(chain.at(i) == before[static_cast<size_t>(i)]);
                CHECK(chain.paramOffsetAt(i) == offsets[static_cast<size_t>(i)]);
            }
        }
    }
    // The order is not the power: each stage keeps its own.
    CHECK(engine.delay().enabled);
    CHECK(!engine.chorus().enabled);
    CHECK(!engine.reverb().enabled);
    CHECK(!engine.tremolo().enabled);
}

static void set_post_order_ignores_anything_but_a_permutation_of_the_four() {
    using S = Engine::Stage;
    Engine engine;
    const ProcessorChain& chain = engine.chainForTest();

    engine.setPostOrder(S::Gate, S::Eq, S::Cab, S::Drive);
    engine.setPostOrder(S::Chorus, S::Chorus, S::Delay, S::Reverb);
    engine.setPostOrder(S::Delay, S::Delay, S::Delay, S::Delay);
    engine.setPostOrder(S::Delay, S::Chorus, S::Reverb, S::Drive);
    engine.setPostOrder(S::Reverb, S::Delay, S::Chorus, static_cast<S>(99));
    // The three-effect order of an older UI is missing the tremolo.
    engine.setPostOrder(S::Reverb, S::Delay, S::Chorus, S::Reverb);

    CHECK(engine.postOrder()[0] == S::Chorus);
    CHECK(engine.postOrder()[1] == S::Tremolo);
    CHECK(engine.postOrder()[2] == S::Delay);
    CHECK(engine.postOrder()[3] == S::Reverb);
    CHECK(chain.at(Engine::kPostEntryIndex) == static_cast<const Processor*>(&engine.chorus()));
    CHECK(chain.at(Engine::kPostEntryIndex + 1) == static_cast<const Processor*>(&engine.tremolo()));
    CHECK(chain.at(Engine::kPostEntryIndex + 2) == static_cast<const Processor*>(&engine.delay()));
    CHECK(chain.at(Engine::kPostEntryIndex + 3) == static_cast<const Processor*>(&engine.reverb()));
}

/** Chorus (12 ms, no sweep) and delay (40 ms) both on, an impulse through them. */
static void setup_both_effects_with_fixed_times(Engine& engine) {
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Eq, false);
    engine.params()[Engine::kChorusParamIndex + 0] = 100.0f;
    engine.params()[Engine::kChorusParamIndex + 1] = 0.8f;
    engine.params()[Engine::kChorusParamIndex + 2] = 0.0f;   // copy due at 576
    engine.params()[Engine::kDelayParamIndex + 0] = 100.0f;
    engine.params()[Engine::kDelayParamIndex + 1] = 40.0f;   // echo due at 1920
    engine.params()[Engine::kDelayParamIndex + 2] = 0.0f;
    engine.setStageEnabled(Engine::Stage::Chorus, true);
    engine.setStageEnabled(Engine::Stage::Delay, true);

    for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = (i == 0) ? 1.0f : 0.0f;
    engine.process(Engine::kMaxBlockSize);
}

static void a_real_order_change_resets_the_effects_that_moved() {
    Engine engine;
    setup_both_effects_with_fixed_times(engine);

    engine.setPostOrder(Engine::Stage::Delay, Engine::Stage::Tremolo, Engine::Stage::Chorus, Engine::Stage::Reverb);

    // Without the resets the chorus copy (at 576) and the echo (at 1920) would
    // still come out of the swapped stages inside these twenty quiet blocks.
    for (int block = 0; block < 20; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.0f;
        engine.process(Engine::kMaxBlockSize);
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) CHECK_CLOSE(engine.buffer()[i], 0.0, 1e-6);
    }
}

static void repeating_the_current_order_does_not_reset() {
    Engine engine;
    setup_both_effects_with_fixed_times(engine);

    engine.setPostOrder(Engine::Stage::Chorus, Engine::Stage::Tremolo, Engine::Stage::Delay,
                        Engine::Stage::Reverb);  // already the order

    float peak = 0.0f;
    for (int block = 0; block < 20; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.0f;
        engine.process(Engine::kMaxBlockSize);
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) peak = std::fmax(peak, std::fabs(engine.buffer()[i]));
    }
    CHECK(peak > 0.9f);
}

static void an_effect_that_keeps_its_place_keeps_ringing() {
    Engine engine;
    setup_both_effects_with_fixed_times(engine);

    // Chorus and reverb trade places; the delay stays third, so its echo, due
    // at 1920, still comes out.
    engine.setPostOrder(Engine::Stage::Reverb, Engine::Stage::Tremolo, Engine::Stage::Delay, Engine::Stage::Chorus);

    float peak = 0.0f;
    for (int block = 0; block < 20; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.0f;
        engine.process(Engine::kMaxBlockSize);
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) peak = std::fmax(peak, std::fabs(engine.buffer()[i]));
    }
    CHECK(peak > 0.9f);
}

/** An impulse through a sweeping chorus and a 40 ms delay, with `first` first. */
static std::vector<float> impulse_through_both_effects(Engine::Stage first) {
    Engine engine;
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Eq, false);
    engine.params()[Engine::kChorusParamIndex + 0] = 100.0f;
    engine.params()[Engine::kChorusParamIndex + 1] = 2.0f;
    engine.params()[Engine::kChorusParamIndex + 2] = 100.0f;
    engine.params()[Engine::kDelayParamIndex + 0] = 100.0f;
    engine.params()[Engine::kDelayParamIndex + 1] = 40.0f;
    engine.params()[Engine::kDelayParamIndex + 2] = 0.0f;
    engine.setStageEnabled(Engine::Stage::Chorus, true);
    engine.setStageEnabled(Engine::Stage::Delay, true);
    if (first == Engine::Stage::Delay) {
        engine.setPostOrder(Engine::Stage::Delay, Engine::Stage::Chorus, Engine::Stage::Tremolo, Engine::Stage::Reverb);
    }

    std::vector<float> out;
    for (int block = 0; block < 40; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) {
            engine.buffer()[i] = (block == 0 && i == 0) ? 1.0f : 0.0f;
        }
        engine.process(Engine::kMaxBlockSize);
        out.insert(out.end(), engine.buffer(), engine.buffer() + Engine::kMaxBlockSize);
    }
    return out;
}

static void the_two_post_orders_sound_different() {
    const std::vector<float> chorusFirst = impulse_through_both_effects(Engine::Stage::Chorus);
    const std::vector<float> delayFirst = impulse_through_both_effects(Engine::Stage::Delay);

    CHECK_CLOSE(chorusFirst[0], 1.0, 1e-6);
    CHECK_CLOSE(delayFirst[0], 1.0, 1e-6);

    // The sweep makes the chorus time-varying, so the order matters: chorus
    // first puts the echoed copy near sample 2543, delay first near 2682.
    float worst = 0.0f;
    for (size_t i = 0; i < chorusFirst.size(); ++i) {
        CHECK_FINITE(chorusFirst[i]);
        CHECK_FINITE(delayFirst[i]);
        worst = std::fmax(worst, std::fabs(chorusFirst[i] - delayFirst[i]));
    }
    CHECK(worst > 0.1f);
}


static void the_reverb_slot_sits_clear_of_the_other_slots() {
    CHECK(Engine::kReverbSlot == Engine::kNamCount + 3);
    CHECK(Engine::kReverbSlot != Engine::kDelaySlot);
    CHECK(Engine::kReverbSlot != Engine::kChorusSlot);
    CHECK(Engine::kReverbSlot != Engine::kDriveSlot);
    CHECK(Engine::kReverbParamIndex == 32);
    // The worklet's STAGE_IDS maps 'reverb' onto this.
    CHECK(static_cast<int32_t>(Engine::Stage::Reverb) == 6);
}

static void the_reverb_starts_disabled_with_its_input_open() {
    Engine engine;
    CHECK(!engine.reverb().enabled);
    CHECK(engine.reverb().inputOpen());
}

static void the_reverb_stage_is_enabled_independently() {
    Engine engine;
    engine.setStageEnabled(Engine::Stage::Reverb, true);
    CHECK(engine.reverb().enabled);
    CHECK(!engine.delay().enabled);
    CHECK(!engine.chorus().enabled);
    CHECK(!engine.drive().enabled);
    CHECK(engine.eq().enabled);
    engine.setStageEnabled(Engine::Stage::Reverb, false);
    CHECK(!engine.reverb().enabled);
}

/** The reverb alone, EQ off, an impulse in the first block; the output of the first `blocks` blocks. */
static std::vector<float> impulse_through_the_reverb(Engine& engine, float mix, int blocks) {
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Eq, false);
    float* p = engine.params() + Engine::kReverbParamIndex;
    p[0] = mix;
    p[1] = 50.0f;
    p[2] = 50.0f;
    p[3] = 10.0f;  // 480 samples of pre-delay
    p[4] = 50.0f;
    p[5] = 1.0f;   // HALL
    engine.setStageEnabled(Engine::Stage::Reverb, true);
    std::vector<float> out;
    for (int block = 0; block < blocks; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = (block == 0 && i == 0) ? 1.0f : 0.0f;
        engine.process(Engine::kMaxBlockSize);
        out.insert(out.end(), engine.buffer(), engine.buffer() + Engine::kMaxBlockSize);
    }
    return out;
}

static void an_enabled_reverb_reads_its_params_from_the_slot_pool() {
    {
        Engine engine;
        const std::vector<float> out = impulse_through_the_reverb(engine, 0.0f, 40);
        CHECK_CLOSE(out[0], 1.0, 1e-6);
        for (size_t i = 1; i < out.size(); ++i) CHECK_CLOSE(out[i], 0.0, 1e-6);  // MIX 0: dry only
    }
    {
        Engine engine;
        const std::vector<float> out = impulse_through_the_reverb(engine, 100.0f, 40);
        CHECK_CLOSE(out[0], 0.0, 1e-6);  // MIX 100: no dry
        for (size_t i = 0; i < 480; ++i) CHECK_CLOSE(out[i], 0.0, 1e-9);  // nothing before the pre-delay
        float tail = 0.0f;
        for (size_t i = 480; i < out.size(); ++i) tail = std::fmax(tail, std::fabs(out[i]));
        CHECK(tail > 1e-3f);
    }
}

static void reengaging_a_bypassed_reverb_resets_it() {
    Engine engine;
    impulse_through_the_reverb(engine, 100.0f, 40);
    engine.setStageEnabled(Engine::Stage::Reverb, false);
    engine.setStageEnabled(Engine::Stage::Reverb, true);
    float peak = 0.0f;
    for (int block = 0; block < 40; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.0f;
        engine.process(Engine::kMaxBlockSize);
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) peak = std::fmax(peak, std::fabs(engine.buffer()[i]));
    }
    CHECK(peak == 0.0f);
}

static void reengaging_an_already_enabled_reverb_does_not_reset_it() {
    Engine engine;
    impulse_through_the_reverb(engine, 100.0f, 40);
    engine.setStageEnabled(Engine::Stage::Reverb, true);
    float peak = 0.0f;
    for (int block = 0; block < 40; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.0f;
        engine.process(Engine::kMaxBlockSize);
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) peak = std::fmax(peak, std::fabs(engine.buffer()[i]));
    }
    CHECK(peak > 1e-3f);
}

static void set_reverb_input_reaches_the_reverb() {
    Engine engine;
    engine.setReverbInput(false);
    CHECK(!engine.reverb().inputOpen());
    engine.setReverbInput(true);
    CHECK(engine.reverb().inputOpen());
}

static void with_its_input_closed_an_enabled_reverb_rings_out_then_passes_the_dry_untouched() {
    Engine engine;
    impulse_through_the_reverb(engine, 100.0f, 40);
    engine.setReverbInput(false);
    // The tail rings on while the stage stays enabled...
    float tail = 0.0f;
    for (int block = 0; block < 10; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.0f;
        engine.process(Engine::kMaxBlockSize);
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) tail = std::fmax(tail, std::fabs(engine.buffer()[i]));
    }
    CHECK(tail > 1e-3f);
    CHECK(engine.reverb().enabled);
    // ...until it is silent and the reverb idles; then the input passes at
    // full level, though MIX 100 would remove it from an open reverb.
    for (int block = 0; block < 3000 && !engine.reverb().idle(); ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.0f;
        engine.process(Engine::kMaxBlockSize);
    }
    CHECK(engine.reverb().idle());
    for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 0.25f;
    engine.process(Engine::kMaxBlockSize);
    for (int i = 0; i < Engine::kMaxBlockSize; ++i) CHECK(engine.buffer()[i] == 0.25f);
}

static void the_tremolo_slot_sits_clear_of_the_other_slots() {
    CHECK(Engine::kTremoloSlot == Engine::kNamCount + 4);
    CHECK(Engine::kTremoloSlot != Engine::kDelaySlot);
    CHECK(Engine::kTremoloSlot != Engine::kChorusSlot);
    CHECK(Engine::kTremoloSlot != Engine::kDriveSlot);
    CHECK(Engine::kTremoloSlot != Engine::kReverbSlot);
    CHECK(Engine::kTremoloParamIndex == 38);
    // The worklet's STAGE_IDS maps 'tremolo' onto this.
    CHECK(static_cast<int32_t>(Engine::Stage::Tremolo) == 7);
}

static void the_tremolo_starts_disabled() {
    Engine engine;
    CHECK(!engine.tremolo().enabled);
}

static void the_tremolo_stage_is_enabled_independently() {
    Engine engine;
    engine.setStageEnabled(Engine::Stage::Tremolo, true);
    CHECK(engine.tremolo().enabled);
    CHECK(!engine.delay().enabled);
    CHECK(!engine.chorus().enabled);
    CHECK(!engine.drive().enabled);
    CHECK(!engine.reverb().enabled);
    CHECK(engine.eq().enabled);
    engine.setStageEnabled(Engine::Stage::Tremolo, false);
    CHECK(!engine.tremolo().enabled);
}

/**
 * The tremolo alone, EQ off, a 1 Hz SQUARE at DEPTH 100 %, fed 1.0 for
 * `blocks` blocks; the output, which is its gain.
 */
static std::vector<float> steady_input_through_the_tremolo(Engine& engine, int blocks) {
    std::vector<float> out;
    for (int block = 0; block < blocks; ++block) {
        for (int i = 0; i < Engine::kMaxBlockSize; ++i) engine.buffer()[i] = 1.0f;
        engine.process(Engine::kMaxBlockSize);
        out.insert(out.end(), engine.buffer(), engine.buffer() + Engine::kMaxBlockSize);
    }
    return out;
}

static void set_up_a_square_tremolo(Engine& engine) {
    engine.prepare(48000.0, Engine::kMaxBlockSize);
    engine.setStageEnabled(Engine::Stage::Eq, false);
    float* p = engine.params() + Engine::kTremoloParamIndex;
    p[0] = 0.0f;    // 0 dB
    p[1] = 1.0f;    // 1 Hz
    p[2] = 100.0f;  // full depth
    p[3] = 2.0f;    // SQUARE
    engine.setStageEnabled(Engine::Stage::Tremolo, true);
}

static void an_enabled_tremolo_reads_its_params_from_the_slot_pool() {
    {
        // 1 Hz SQUARE: up for the first half second, silent for the second.
        Engine engine;
        set_up_a_square_tremolo(engine);
        const std::vector<float> out = steady_input_through_the_tremolo(engine, 375);  // 1 s
        CHECK_CLOSE(out[12000], 1.0, 1e-4);
        CHECK_CLOSE(out[36000], 0.0, 1e-4);
    }
    {
        // DEPTH 0 and LEVEL -6 dB: a steady trim of 10^(-6/20).
        Engine engine;
        set_up_a_square_tremolo(engine);
        engine.params()[Engine::kTremoloParamIndex + 0] = -6.0f;
        engine.params()[Engine::kTremoloParamIndex + 2] = 0.0f;
        const std::vector<float> out = steady_input_through_the_tremolo(engine, 4);
        CHECK_CLOSE(out.back(), 0.501187, 1e-4);
    }
}

static void reengaging_a_bypassed_tremolo_restarts_its_wave() {
    Engine engine;
    set_up_a_square_tremolo(engine);
    CHECK(steady_input_through_the_tremolo(engine, 300).back() < 1e-3);  // 0.8 s: the bottom
    engine.setStageEnabled(Engine::Stage::Tremolo, false);
    engine.setStageEnabled(Engine::Stage::Tremolo, true);
    CHECK_CLOSE(steady_input_through_the_tremolo(engine, 1)[0], 1.0, 1e-6);  // the top again
}

static void reengaging_an_already_enabled_tremolo_does_not_reset_it() {
    Engine engine;
    set_up_a_square_tremolo(engine);
    steady_input_through_the_tremolo(engine, 300);
    engine.setStageEnabled(Engine::Stage::Tremolo, true);
    CHECK(steady_input_through_the_tremolo(engine, 1)[0] < 1e-3);  // still at the bottom
}

static void moving_the_tremolo_restarts_its_wave_and_leaving_it_does_not() {
    using S = Engine::Stage;
    {
        Engine engine;
        set_up_a_square_tremolo(engine);
        steady_input_through_the_tremolo(engine, 300);
        engine.setPostOrder(S::Tremolo, S::Chorus, S::Delay, S::Reverb);  // moved first
        CHECK_CLOSE(steady_input_through_the_tremolo(engine, 1)[0], 1.0, 1e-6);
    }
    {
        Engine engine;
        set_up_a_square_tremolo(engine);
        steady_input_through_the_tremolo(engine, 300);
        engine.setPostOrder(S::Reverb, S::Tremolo, S::Delay, S::Chorus);  // still second
        CHECK(steady_input_through_the_tremolo(engine, 1)[0] < 1e-3);
    }
}

static void run_tests() {
    the_param_block_matches_the_typescript_declaration();
    the_param_block_starts_zeroed();
    a_zeroed_param_block_is_unity_gain_and_flat_eq();
    the_output_volume_param_attenuates();
    the_input_gain_param_multiplies_before_the_eq();
    the_eq_params_are_wired_to_the_right_bands();
    a_short_block_only_touches_that_many_frames();
    an_oversized_block_is_clamped_rather_than_overrunning();
    the_nam_pool_fits_inside_the_slot_pool();
    the_staging_buffer_is_addressable_and_the_right_size();
    a_nam_stage_starts_disabled_with_no_model();
    loading_a_model_records_it_on_the_named_slot();
    staged_bytes_that_are_not_a_model_are_rejected();
    loading_an_out_of_range_slot_is_rejected();
    an_oversized_load_is_rejected_at_the_engine_boundary();
    enabling_a_nam_stage_is_slot_addressed();
    an_enabled_nam_stage_does_not_alter_the_tone_stack();
    nam_accessor_returns_the_right_stage_for_every_valid_slot();
    the_eq_level_param_scales_the_output();
    the_chain_runs_gate_input_gain_drive_nam_cab_chorus_tremolo_delay_reverb_eq_output();
    the_eq_starts_enabled_and_can_be_bypassed();
    an_engaged_nam_stage_applies_its_level_from_the_slot_pool();
    a_bypassed_nam_stage_ignores_its_level();
    the_gate_starts_disabled();
    stages_are_enabled_independently();
    the_gate_reads_its_threshold_from_the_param_block();
    the_gate_hears_the_signal_before_input_gain();
    reengaging_a_bypassed_gate_resets_it();
    reengaging_an_already_enabled_gate_does_not_reopen_it();
    the_cab_starts_disabled_with_no_ir();
    the_cab_stage_is_enabled_independently();
    an_oversized_cab_ir_is_rejected_at_the_engine_boundary();
    the_cab_convolves_and_reads_its_level_from_the_param_block();
    a_disabled_cab_does_not_touch_the_signal();
    reengaging_a_bypassed_cab_clears_its_history();
    the_delay_slot_sits_clear_of_the_nam_slots();
    the_delay_starts_disabled();
    the_delay_stage_is_enabled_independently();
    an_enabled_delay_reads_its_params_from_the_slot_pool();
    a_disabled_delay_does_not_touch_the_signal();
    reengaging_a_bypassed_delay_clears_its_line();
    reengaging_an_already_enabled_delay_does_not_reset_it();
    the_chorus_slot_sits_clear_of_the_nam_and_delay_slots();
    the_chorus_starts_disabled();
    the_chorus_stage_is_enabled_independently();
    an_enabled_chorus_reads_its_params_from_the_slot_pool();
    a_disabled_chorus_does_not_touch_the_signal();
    reengaging_a_bypassed_chorus_clears_its_line();
    reengaging_an_already_enabled_chorus_does_not_reset_it();
    set_post_order_reaches_every_permutation_and_moves_only_the_post_effects();
    set_post_order_ignores_anything_but_a_permutation_of_the_four();
    a_real_order_change_resets_the_effects_that_moved();
    an_effect_that_keeps_its_place_keeps_ringing();
    repeating_the_current_order_does_not_reset();
    the_two_post_orders_sound_different();

    the_drive_slot_sits_clear_of_the_other_slots();
    the_drive_starts_disabled();
    the_drive_stage_is_enabled_independently();
    an_enabled_drive_reads_its_params_from_the_slot_pool();
    a_disabled_drive_does_not_touch_the_signal();
    reengaging_a_bypassed_drive_resets_it();
    reengaging_an_already_enabled_drive_does_not_reset_it();
    set_post_order_leaves_the_drive_in_place();

    the_reverb_slot_sits_clear_of_the_other_slots();
    the_reverb_starts_disabled_with_its_input_open();
    the_reverb_stage_is_enabled_independently();
    an_enabled_reverb_reads_its_params_from_the_slot_pool();
    reengaging_a_bypassed_reverb_resets_it();
    reengaging_an_already_enabled_reverb_does_not_reset_it();
    set_reverb_input_reaches_the_reverb();
    with_its_input_closed_an_enabled_reverb_rings_out_then_passes_the_dry_untouched();

    the_tremolo_slot_sits_clear_of_the_other_slots();
    the_tremolo_starts_disabled();
    the_tremolo_stage_is_enabled_independently();
    an_enabled_tremolo_reads_its_params_from_the_slot_pool();
    reengaging_a_bypassed_tremolo_restarts_its_wave();
    reengaging_an_already_enabled_tremolo_does_not_reset_it();
    moving_the_tremolo_restarts_its_wave_and_leaving_it_does_not();
}

TEST_MAIN("Engine")

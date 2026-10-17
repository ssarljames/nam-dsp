#pragma once

#include <array>
#include <cassert>
#include <cstdint>
#include <vector>

#include "CabProcessor.h"
#include "ChorusProcessor.h"
#include "DelayProcessor.h"
#include "DriveProcessor.h"
#include "EqProcessor.h"
#include "GainProcessor.h"
#include "GateProcessor.h"
#include "NamProcessor.h"
#include "ProcessorChain.h"
#include "ReverbProcessor.h"
#include "TremoloProcessor.h"

/**
 * The whole engine: Gate -> InputGain -> Drive -> Nam[0..kNamCount-1] -> Cab -> {Chorus, Tremolo, Delay, Reverb in any order} -> Eq -> OutputVolume.
 *
 * Every processor and every buffer is a member, so construction is the only
 * time anything is allocated. The JS side derives `buffer()` and `params()`
 * once and never again, because WASM memory growth would invalidate its views
 * (which is why the module is built with ALLOW_MEMORY_GROWTH=0).
 */
class Engine {
public:
    /** The Web Audio render quantum. */
    static constexpr int32_t kMaxBlockSize = 128;

    /** Must equal PARAM_COUNT in src/audio/params.ts. */
    static constexpr int32_t kParamCount = 56;

    static constexpr int32_t kInputGainIndex = 0;
    static constexpr int32_t kEqBaseIndex = 1;  // bass, mid, treble, then the EQ's level
    static constexpr int32_t kEqLevelIndex = 4;
    static constexpr int32_t kOutputVolumeIndex = 5;
    static constexpr int32_t kGateThresholdIndex = 6;
    static constexpr int32_t kCabLevelIndex = 7;
    static constexpr int32_t kSlotBaseIndex = 8;  // slot0_p0 .. slot7_p5

    /** Params per pooled slot. Mirrors PARAMS_PER_SLOT in src/audio/params.ts. */
    static constexpr int32_t kParamsPerSlot = 6;

    /** NAM stages in the chain. Raising this is how several models are chained. */
    static constexpr int32_t kNamCount = 1;

    /**
     * The delay's pooled slot: the first one after the NAM stages, so its params
     * are slot1_p0 level, slot1_p1 time, slot1_p2 feedback. Mirrors DELAY_SLOT
     * in src/audio/params.ts.
     */
    static constexpr int32_t kDelaySlot = kNamCount;
    static constexpr int32_t kDelayParamIndex = kSlotBaseIndex + kDelaySlot * kParamsPerSlot;

    /**
     * The chorus's pooled slot: the one after the delay's, so its params are
     * slot2_p0 level, slot2_p1 rate, slot2_p2 depth. Mirrors CHORUS_SLOT in
     * src/audio/params.ts.
     */
    static constexpr int32_t kChorusSlot = kNamCount + 1;
    static constexpr int32_t kChorusParamIndex = kSlotBaseIndex + kChorusSlot * kParamsPerSlot;

    /**
     * The drive's pooled slot: the one after the chorus's, so its params are
     * slot3_p0 level, slot3_p1 gain, slot3_p2 tone, slot3_p3 type. Mirrors
     * DRIVE_SLOT in src/audio/params.ts.
     */
    static constexpr int32_t kDriveSlot = kNamCount + 2;
    static constexpr int32_t kDriveParamIndex = kSlotBaseIndex + kDriveSlot * kParamsPerSlot;

    /**
     * The reverb's pooled slot: the one after the drive's, so its params are
     * slot4_p0 mix, p1 decay, p2 tone, p3 pre-delay, p4 the type's knob and
     * p5 the type. Mirrors REVERB_SLOT in src/audio/params.ts.
     */
    static constexpr int32_t kReverbSlot = kNamCount + 3;
    static constexpr int32_t kReverbParamIndex = kSlotBaseIndex + kReverbSlot * kParamsPerSlot;

    /**
     * The tremolo's pooled slot: the one after the reverb's, so its params are
     * slot5_p0 level, p1 rate, p2 depth and p3 the wave. Mirrors TREMOLO_SLOT
     * in src/audio/params.ts.
     */
    static constexpr int32_t kTremoloSlot = kNamCount + 4;
    static constexpr int32_t kTremoloParamIndex = kSlotBaseIndex + kTremoloSlot * kParamsPerSlot;

    /**
     * Where the POST effects sit in the chain: after the gate, input gain, the
     * drive, the NAM stages and the cab, kPostCount entries in a row.
     * setPostOrder() rearranges those entries and no others.
     */
    static constexpr int32_t kPostEntryIndex = 4 + kNamCount;
    static constexpr int32_t kPostCount = 4;

    /** Largest model payload the staging buffer accepts. */
    static constexpr int32_t kMaxModelBytes = NamProcessor::kMaxModelBytes;

    /** Longest IR the cab accepts, in taps. */
    static constexpr int32_t kMaxCabTaps = CabProcessor::kMaxTaps;

    // The core layout is contiguous, and these asserts are what keep it that
    // way. Without them, giving the EQ a fourth band would silently alias
    // outputVolume's slot: no compiler error, no failing test, just a knob
    // driving the wrong parameter. The same layout is encoded in PARAM_ORDER in
    // src/audio/params.ts, so a change here means a change there.
    static_assert(kEqBaseIndex == kInputGainIndex + 1,
                  "inputGain occupies exactly one slot before the EQ");
    static_assert(kEqLevelIndex == kEqBaseIndex + EqProcessor::kBandCount,
                  "the EQ's level sits immediately after its bands");
    static_assert(kOutputVolumeIndex == kEqBaseIndex + EqProcessor::kParamCount,
                  "outputVolume must sit immediately after the EQ's whole slice");
    static_assert(kGateThresholdIndex == kOutputVolumeIndex + 1,
                  "gateThreshold sits immediately after outputVolume");
    static_assert(kCabLevelIndex == kGateThresholdIndex + 1,
                  "cabLevel sits immediately after gateThreshold");
    static_assert(kSlotBaseIndex == kCabLevelIndex + 1,
                  "the Phase 3 slot pool starts immediately after the core params");
    static_assert(kParamCount == kSlotBaseIndex + 8 * kParamsPerSlot,
                  "56 = 8 core params + 8 slots x kParamsPerSlot; mirrors PARAM_COUNT in params.ts");
    static_assert(kNamCount * kParamsPerSlot <= kParamCount - kSlotBaseIndex,
                  "NAM stages must fit inside the pre-declared slot pool");
    static_assert((kDelaySlot + 1) * kParamsPerSlot <= kParamCount - kSlotBaseIndex,
                  "the delay's slot must fit inside the pre-declared slot pool");
    static_assert((kChorusSlot + 1) * kParamsPerSlot <= kParamCount - kSlotBaseIndex,
                  "the chorus's slot must fit inside the pre-declared slot pool");
    static_assert(kDelaySlot >= kNamCount && kChorusSlot >= kNamCount,
                  "the effects' slots must sit clear of the NAM stages");
    static_assert(kChorusSlot != kDelaySlot, "the chorus and the delay need a slot each");
    static_assert((kDriveSlot + 1) * kParamsPerSlot <= kParamCount - kSlotBaseIndex,
                  "the drive's slot must fit inside the pre-declared slot pool");
    static_assert(kDriveSlot >= kNamCount, "the drive's slot must sit clear of the NAM stages");
    static_assert(kDriveSlot != kDelaySlot && kDriveSlot != kChorusSlot,
                  "the drive needs a slot of its own");
    static_assert(DriveProcessor::kTypeCount <= kParamsPerSlot, "the drive's params fit its slot");
    static_assert((kReverbSlot + 1) * kParamsPerSlot <= kParamCount - kSlotBaseIndex,
                  "the reverb's slot must fit inside the pre-declared slot pool");
    static_assert(kReverbSlot >= kNamCount, "the reverb's slot must sit clear of the NAM stages");
    static_assert(kReverbSlot != kDelaySlot && kReverbSlot != kChorusSlot && kReverbSlot != kDriveSlot,
                  "the reverb needs a slot of its own");
    static_assert((kTremoloSlot + 1) * kParamsPerSlot <= kParamCount - kSlotBaseIndex,
                  "the tremolo's slot must fit inside the pre-declared slot pool");
    static_assert(kTremoloSlot >= kNamCount, "the tremolo's slot must sit clear of the NAM stages");
    static_assert(kTremoloSlot != kDelaySlot && kTremoloSlot != kChorusSlot && kTremoloSlot != kDriveSlot &&
                      kTremoloSlot != kReverbSlot,
                  "the tremolo needs a slot of its own");
    static_assert(4 <= kParamsPerSlot, "the tremolo's four params fit its slot");

    /**
     * The named core stages that have a power button. NAM stages are
     * numbered and keep their own slot-addressed setNamEnabled(). The values
     * are the wire format: the worklet maps 'gate' | 'eq' | 'cab' | 'delay' |
     * 'chorus' | 'drive' | 'reverb' | 'tremolo' onto them.
     */
    enum class Stage : int32_t { Gate = 0, Eq = 1, Cab = 2, Delay = 3, Chorus = 4, Drive = 5, Reverb = 6, Tremolo = 7 };

    Engine();

    void prepare(double sampleRate, int32_t maxBlockSize);
    void reset();

    /** RT-safe. Processes in place on buffer(). */
    void process(int32_t numFrames);

    float* buffer() { return buffer_; }
    float* params() { return params_; }
    double sampleRate() const { return sampleRate_; }

    /** Where the worklet copies model bytes before calling loadNamModel(). */
    uint8_t* modelStaging() { return staging_.data(); }

    /** Builds slot `slot`'s model from the first `byteLength` staged bytes. */
    bool loadNamModel(int32_t slot, int32_t byteLength);

    void setNamEnabled(int32_t slot, bool enabled);

    /** A core stage's power button. The gate and cab start disabled, the EQ enabled. */
    void setStageEnabled(Stage stage, bool enabled);

    /**
     * The order of the POST effects, first to last: a permutation of
     * Stage::Chorus, Stage::Tremolo, Stage::Delay and Stage::Reverb. Anything
     * else changes nothing, and so does repeating the current order. A real
     * change rearranges the chain entries and resets the processors whose
     * position changed, so no stale tail plays from a new position while one
     * that kept its place rings on (spec 2026-10-01-reverb-effect §3.3,
     * 2026-10-06-tremolo-effect §3.3). Allocates nothing; the worklet calls it
     * between render quanta.
     */
    void setPostOrder(Stage first, Stage second, Stage third, Stage fourth);

    /** The POST effects in the order they run. Chorus, Tremolo, Delay, Reverb until told otherwise. */
    const std::array<Stage, kPostCount>& postOrder() const { return postOrder_; }

    /**
     * Opens or closes the reverb's input (trails, spec 2026-10-01-reverb-effect
     * §3.4). Closed, an enabled reverb passes the dry signal at full level and
     * lets its tail ring out. Open until told otherwise.
     */
    void setReverbInput(bool open);

    /** Where the worklet writes an IR's taps before calling loadCabIr(). */
    float* cabIrStaging() { return cab_.staging(); }

    /** Commits the first `length` staged taps as the cab's IR. False if rejected. */
    bool loadCabIr(int32_t length);

    const CabProcessor& cab() const { return cab_; }
    const DelayProcessor& delay() const { return delay_; }
    const ChorusProcessor& chorus() const { return chorus_; }
    const DriveProcessor& drive() const { return drive_; }
    const ReverbProcessor& reverb() const { return reverb_; }
    const TremoloProcessor& tremolo() const { return tremolo_; }

    const EqProcessor& eq() const { return eq_; }
    const GateProcessor& gate() const { return gate_; }

    /** The chain itself, so a test can assert order and parameter offsets directly. */
    const ProcessorChain& chainForTest() const { return chain_; }

    const NamProcessor& nam(int32_t slot) const {
        assert(slot >= 0 && slot < kNamCount && "Engine::nam: slot out of range");
        // A reference-returning accessor can't early-return like loadNamModel/
        // setNamEnabled do. nam() is only reached from engine/tests/test_engine.cpp
        // today (bindings.cpp never calls it), so in every build that currently
        // exists the assert above is what actually catches misuse. The clamp
        // below is defense in depth for a future caller reached from a build
        // where asserts are compiled out: it keeps an out-of-range index from
        // reading past nam_ into whatever member follows it.
        const int32_t clamped = slot < 0 ? 0 : (slot >= kNamCount ? kNamCount - 1 : slot);
        return nam_[clamped];
    }

private:
    float buffer_[kMaxBlockSize] = {};
    float params_[kParamCount] = {};

    GateProcessor gate_;
    CabProcessor cab_;
    DelayProcessor delay_;
    ChorusProcessor chorus_;
    DriveProcessor drive_;
    ReverbProcessor reverb_;
    TremoloProcessor tremolo_;
    GainProcessor inputGain_;
    EqProcessor eq_;
    GainProcessor outputVolume_;

    NamProcessor nam_[kNamCount];

    // A vector, not a fixed member array: 8 MiB inside the object would blow
    // the stack of every host test that declares `Engine engine;`. Sized once
    // in the constructor and never resized, so data() is a stable pointer —
    // which the worklet depends on, having derived it exactly once.
    std::vector<uint8_t> staging_;

    ProcessorChain chain_;

    double sampleRate_ = 48000.0;

    std::array<Stage, kPostCount> postOrder_ = {Stage::Chorus, Stage::Tremolo, Stage::Delay, Stage::Reverb};

    /** The processor behind a POST stage. Only called with Chorus, Tremolo, Delay or Reverb. */
    Processor& postProcessor(Stage stage);
};

#include "NamProcessor.h"
#include "test_util.h"

#include <cmath>
#include <cstdint>
#include <fstream>
#include <string>
#include <vector>

namespace {

/** A real .nam document. lstm.nam is the smallest the library ships. */
std::vector<uint8_t> read_example(const char* name) {
    const std::string path = std::string(NAM_EXAMPLE_MODELS_DIR) + "/" + name;
    std::ifstream file(path, std::ios::binary);
    if (!file) {
        testutil::report(__FILE__, __LINE__, "could not open example model: " + path);
        return {};
    }
    return std::vector<uint8_t>((std::istreambuf_iterator<char>(file)),
                                std::istreambuf_iterator<char>());
}

std::vector<uint8_t> garbage(int32_t length, uint8_t fill = 0xAB) {
    return std::vector<uint8_t>(static_cast<size_t>(length), fill);
}

}  // namespace

static void a_fresh_stage_has_no_model() {
    NamProcessor nam;
    CHECK(!nam.hasModel());
    CHECK(nam.modelByteLength() == 0);
    CHECK(nam.modelSampleRate() == 0.0);
}

static void processing_without_a_model_leaves_the_buffer_untouched() {
    NamProcessor nam;
    nam.prepare(48000.0, 128);

    float buffer[128];
    for (int i = 0; i < 128; ++i) buffer[i] = 0.25f;

    nam.process(buffer, 128);

    // Transparent until something is loaded — deliberately not silence.
    for (int i = 0; i < 128; ++i) CHECK(buffer[i] == 0.25f);
}

static void a_real_model_loads_and_reports_its_rate() {
    NamProcessor nam;
    nam.prepare(48000.0, 128);
    const std::vector<uint8_t> model = read_example("lstm.nam");
    CHECK(!model.empty());

    CHECK(nam.loadFrom(model.data(), static_cast<int32_t>(model.size())));
    CHECK(nam.hasModel());
    CHECK(nam.modelByteLength() == static_cast<int32_t>(model.size()));
    CHECK(nam.modelSampleRate() > 0.0);
}

static void a_loaded_model_actually_changes_the_signal() {
    NamProcessor nam;
    nam.prepare(48000.0, 128);
    const std::vector<uint8_t> model = read_example("lstm.nam");
    CHECK(nam.loadFrom(model.data(), static_cast<int32_t>(model.size())));

    float buffer[128];
    for (int i = 0; i < 128; ++i) buffer[i] = 0.25f;
    nam.process(buffer, 128);

    // The whole point of the stage: inference ran and the output is not the
    // input. A pass-through regression would leave every sample at 0.25.
    bool changed = false;
    for (int i = 0; i < 128; ++i) {
        CHECK_FINITE(buffer[i]);
        if (buffer[i] != 0.25f) changed = true;
    }
    CHECK(changed);
}

static void consecutive_loads_alternate_slots_so_the_old_model_is_never_touched() {
    NamProcessor nam;
    nam.prepare(48000.0, 128);
    const std::vector<uint8_t> model = read_example("lstm.nam");

    CHECK(nam.loadFrom(model.data(), static_cast<int32_t>(model.size())));
    const void* afterFirst = nam.activeModelForTest();

    CHECK(nam.loadFrom(model.data(), static_cast<int32_t>(model.size())));
    const void* afterSecond = nam.activeModelForTest();

    // The second load built into the other slot and swapped: a different
    // address, so nothing was mutated underneath a running process().
    CHECK(afterFirst != afterSecond);
}

static void a_payload_that_is_not_a_model_is_rejected_and_leaves_the_active_one() {
    NamProcessor nam;
    nam.prepare(48000.0, 128);
    const std::vector<uint8_t> model = read_example("lstm.nam");
    CHECK(nam.loadFrom(model.data(), static_cast<int32_t>(model.size())));
    const int32_t loaded = nam.modelByteLength();

    const std::vector<uint8_t> junk = garbage(2048);
    CHECK(!nam.loadFrom(junk.data(), 2048));

    CHECK(nam.hasModel());
    CHECK(nam.modelByteLength() == loaded);
}

static void well_formed_json_that_is_not_a_model_is_rejected() {
    NamProcessor nam;
    nam.prepare(48000.0, 128);
    const std::string json = R"({"version":"0.5.2","architecture":"NotAThing"})";
    const auto* bytes = reinterpret_cast<const uint8_t*>(json.data());

    CHECK(!nam.loadFrom(bytes, static_cast<int32_t>(json.size())));
    CHECK(!nam.hasModel());
}

static void an_empty_payload_is_rejected_and_leaves_the_active_model() {
    NamProcessor nam;
    nam.prepare(48000.0, 128);
    const std::vector<uint8_t> model = read_example("lstm.nam");
    CHECK(nam.loadFrom(model.data(), static_cast<int32_t>(model.size())));

    CHECK(!nam.loadFrom(model.data(), 0));

    CHECK(nam.hasModel());
}

static void an_oversized_payload_is_rejected_before_anything_is_parsed() {
    NamProcessor nam;
    const std::vector<uint8_t> small = garbage(256);
    CHECK(!nam.loadFrom(small.data(), NamProcessor::kMaxModelBytes + 1));
    CHECK(!nam.hasModel());
}

static void a_null_payload_is_rejected() {
    NamProcessor nam;
    CHECK(!nam.loadFrom(nullptr, 128));
    CHECK(!nam.hasModel());
}

static void a_short_block_only_touches_that_many_frames() {
    NamProcessor nam;
    nam.prepare(48000.0, 128);
    const std::vector<uint8_t> model = read_example("lstm.nam");
    CHECK(nam.loadFrom(model.data(), static_cast<int32_t>(model.size())));

    float buffer[128];
    for (int i = 0; i < 128; ++i) buffer[i] = 1.0f;
    buffer[64] = 99.0f;

    nam.process(buffer, 64);

    CHECK(buffer[64] == 99.0f);
}

static void an_empty_engaged_stage_applies_its_level() {
    NamProcessor nam;
    nam.prepare(48000.0, 128);
    const float params[6] = {6.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f};
    nam.setParams(params);

    float buffer[128];
    for (int block = 0; block < 100; ++block) {
        for (int i = 0; i < 128; ++i) buffer[i] = 0.25f;
        nam.process(buffer, 128);
    }

    // No model, so the signal passes through — and the level still applies.
    CHECK_CLOSE(buffer[127], 0.25 * 1.995262, 1e-3);
}

static void a_loaded_models_output_scales_with_its_level() {
    const std::vector<uint8_t> model = read_example("lstm.nam");
    NamProcessor unity;
    NamProcessor boosted;
    unity.prepare(48000.0, 128);
    boosted.prepare(48000.0, 128);
    CHECK(unity.loadFrom(model.data(), static_cast<int32_t>(model.size())));
    CHECK(boosted.loadFrom(model.data(), static_cast<int32_t>(model.size())));

    const float zeroDb[6] = {0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f};
    const float plusSix[6] = {6.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f};
    unity.setParams(zeroDb);
    boosted.setParams(plusSix);

    float a[128];
    float b[128];
    for (int block = 0; block < 100; ++block) {
        for (int i = 0; i < 128; ++i) {
            a[i] = b[i] = 0.1f * static_cast<float>(std::sin(0.05 * (block * 128 + i)));
        }
        unity.process(a, 128);
        boosted.process(b, 128);
    }

    // Same model, same input: the level is applied after the model, so the only
    // difference between the two outputs is that factor.
    for (int i = 0; i < 128; ++i) {
        CHECK_FINITE(b[i]);
        if (std::fabs(a[i]) > 1e-4f) CHECK_CLOSE(b[i] / a[i], 1.995262, 1e-3);
    }
}

static void run_tests() {
    a_fresh_stage_has_no_model();
    processing_without_a_model_leaves_the_buffer_untouched();
    a_real_model_loads_and_reports_its_rate();
    a_loaded_model_actually_changes_the_signal();
    consecutive_loads_alternate_slots_so_the_old_model_is_never_touched();
    a_payload_that_is_not_a_model_is_rejected_and_leaves_the_active_one();
    well_formed_json_that_is_not_a_model_is_rejected();
    an_empty_payload_is_rejected_and_leaves_the_active_model();
    an_oversized_payload_is_rejected_before_anything_is_parsed();
    a_null_payload_is_rejected();
    a_short_block_only_touches_that_many_frames();
    an_empty_engaged_stage_applies_its_level();
    a_loaded_models_output_scales_with_its_level();
}

TEST_MAIN("NamProcessor")

#include "DspMath.h"
#include "GainProcessor.h"
#include "test_util.h"

static void db_to_linear_is_correct_at_the_landmarks() {
    CHECK_CLOSE(dbToLinear(0.0f), 1.0, 1e-6);
    CHECK_CLOSE(dbToLinear(6.0f), 1.995262, 1e-5);
    CHECK_CLOSE(dbToLinear(-6.0f), 0.501187, 1e-5);
    CHECK_CLOSE(dbToLinear(20.0f), 10.0, 1e-4);
    // At or below the floor the control is a mute, not a very small gain.
    CHECK(dbToLinear(kMinusInfinityDb) == 0.0f);
    CHECK(dbToLinear(-120.0f) == 0.0f);
}

static void unity_gain_passes_the_signal_through_unchanged() {
    GainProcessor gain;
    gain.prepare(48000.0, 128);

    const float params[1] = {0.0f};
    gain.setParams(params);

    float buffer[128];
    for (int i = 0; i < 128; ++i) buffer[i] = 0.5f;
    gain.process(buffer, 128);

    for (int i = 0; i < 128; ++i) CHECK_CLOSE(buffer[i], 0.5f, 1e-6);
}

static void converges_to_the_requested_gain() {
    GainProcessor gain;
    gain.prepare(48000.0, 128);

    const float params[1] = {6.0f};
    float buffer[128];

    // 200 ms of blocks is far more than the 20 ms time constant needs.
    for (int block = 0; block < 75; ++block) {
        gain.setParams(params);
        for (int i = 0; i < 128; ++i) buffer[i] = 1.0f;
        gain.process(buffer, 128);
    }

    CHECK_CLOSE(buffer[127], 1.995262, 1e-3);
}

static void does_not_jump_on_a_large_step() {
    GainProcessor gain;
    gain.prepare(48000.0, 128);

    // Start settled at unity.
    const float unity[1] = {0.0f};
    float buffer[128];
    for (int block = 0; block < 75; ++block) {
        gain.setParams(unity);
        for (int i = 0; i < 128; ++i) buffer[i] = 1.0f;
        gain.process(buffer, 128);
    }

    // Then slam the knob to +24 dB (~15.85x) in one k-rate step.
    const float loud[1] = {24.0f};
    gain.setParams(loud);
    for (int i = 0; i < 128; ++i) buffer[i] = 1.0f;
    gain.process(buffer, 128);

    // Without smoothing, buffer[0] would already be 15.85. With a 20 ms
    // constant at 48 kHz it should still be close to unity.
    CHECK(buffer[0] < 1.05f);
    // ...and it must be climbing, not stuck.
    CHECK(buffer[127] > buffer[0]);
    // Every sample in the block is finite and monotonically increasing.
    for (int i = 1; i < 128; ++i) {
        CHECK_FINITE(buffer[i]);
        CHECK(buffer[i] >= buffer[i - 1]);
    }
}

static void mutes_at_the_floor() {
    GainProcessor gain;
    gain.prepare(48000.0, 128);

    const float silent[1] = {kMinusInfinityDb};
    float buffer[128];
    for (int block = 0; block < 150; ++block) {
        gain.setParams(silent);
        for (int i = 0; i < 128; ++i) buffer[i] = 1.0f;
        gain.process(buffer, 128);
    }

    CHECK(buffer[127] == 0.0f);
}

static void reset_settles_immediately_on_the_current_target() {
    GainProcessor gain;
    gain.prepare(48000.0, 128);

    const float params[1] = {-6.0f};
    gain.setParams(params);
    gain.reset();

    float buffer[128];
    for (int i = 0; i < 128; ++i) buffer[i] = 1.0f;
    gain.process(buffer, 128);

    CHECK_CLOSE(buffer[0], 0.501187, 1e-5);
}

static void run_tests() {
    db_to_linear_is_correct_at_the_landmarks();
    unity_gain_passes_the_signal_through_unchanged();
    converges_to_the_requested_gain();
    does_not_jump_on_a_large_step();
    mutes_at_the_floor();
    reset_settles_immediately_on_the_current_target();
}

TEST_MAIN("GainProcessor")

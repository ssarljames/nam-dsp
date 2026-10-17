#include "GateProcessor.h"
#include "test_util.h"

#include <cmath>
#include <limits>

namespace {

constexpr double kRate = 48000.0;
constexpr int kBlock = 128;
constexpr double kPi = 3.14159265358979323846;

float dbToAmp(float db) { return std::pow(10.0f, db / 20.0f); }

/** A 1 kHz sine at a fixed amplitude. Amplitude 0 is digital silence. */
struct Sine {
    float amp;
    double phase = 0.0;

    void fill(float* buffer, int n) {
        const double increment = 2.0 * kPi * 1000.0 / kRate;
        for (int i = 0; i < n; ++i) {
            buffer[i] = amp * static_cast<float>(std::sin(phase));
            phase += increment;
        }
    }
};

void setThreshold(GateProcessor& gate, float db) {
    const float params[1] = {db};
    gate.setParams(params);
}

void prepared(GateProcessor& gate, float thresholdDb) {
    gate.prepare(kRate, kBlock);
    setThreshold(gate, thresholdDb);
}

/** Runs `seconds` of `source` through the gate; returns the peak |output| of the last block. */
float run(GateProcessor& gate, Sine& source, double seconds) {
    const int blocks = static_cast<int>(seconds * kRate / kBlock) + 1;
    float buffer[kBlock];
    float peak = 0.0f;
    for (int b = 0; b < blocks; ++b) {
        source.fill(buffer, kBlock);
        gate.process(buffer, kBlock);
        if (b == blocks - 1) {
            for (int i = 0; i < kBlock; ++i) {
                const float a = std::fabs(buffer[i]);
                if (a > peak) peak = a;
            }
        }
    }
    return peak;
}

}  // namespace

static void a_signal_above_threshold_opens_the_gate_and_passes_at_unity() {
    GateProcessor gate;
    prepared(gate, -40.0f);

    Sine silence{0.0f};
    run(gate, silence, 1.0);
    CHECK(!gate.isOpen());

    // 20 ms is 40 opening time constants: fully open to float precision.
    Sine note{dbToAmp(-20.0f)};
    run(gate, note, 0.02);
    CHECK(gate.isOpen());
    CHECK_CLOSE(gate.gainForTest(), 1.0, 1e-5);

    float in[kBlock];
    float out[kBlock];
    note.fill(in, kBlock);
    for (int i = 0; i < kBlock; ++i) out[i] = in[i];
    gate.process(out, kBlock);
    for (int i = 0; i < kBlock; ++i) CHECK_CLOSE(out[i], in[i], 1e-5);
}

static void a_signal_below_threshold_closes_the_gate_to_the_floor() {
    GateProcessor gate;
    prepared(gate, -40.0f);

    const float amp = dbToAmp(-70.0f);
    Sine hum{amp};
    const float peak = run(gate, hum, 2.0);

    CHECK(!gate.isOpen());
    CHECK(peak <= amp * dbToAmp(-89.0f));
    // Closed is a −90 dB floor, not a hard zero.
    CHECK(peak > 0.0f);
}

static void silence_closes_the_gate() {
    GateProcessor gate;
    prepared(gate, -40.0f);

    Sine silence{0.0f};
    run(gate, silence, 2.0);

    CHECK(!gate.isOpen());
    CHECK(gate.gainForTest() <= dbToAmp(-89.0f));
}

static void an_open_gate_holds_open_inside_the_hysteresis_band() {
    GateProcessor gate;
    prepared(gate, -40.0f);  // opens above −40 dB, closes below −46 dB

    // reset() leaves the gate open; 3 dB under the threshold must not close it.
    Sine decaying{dbToAmp(-43.0f)};
    run(gate, decaying, 1.0);

    CHECK(gate.isOpen());
    CHECK_CLOSE(gate.gainForTest(), 1.0, 1e-5);
}

static void a_closed_gate_stays_closed_inside_the_hysteresis_band() {
    GateProcessor gate;
    prepared(gate, -40.0f);

    Sine silence{0.0f};
    run(gate, silence, 1.0);
    CHECK(!gate.isOpen());

    // The same −43 dB signal does not reach the opening threshold.
    Sine quiet{dbToAmp(-43.0f)};
    run(gate, quiet, 1.0);
    CHECK(!gate.isOpen());
}

static void a_signal_below_the_hysteresis_band_closes_an_open_gate() {
    GateProcessor gate;
    prepared(gate, -40.0f);

    Sine tail{dbToAmp(-48.0f)};
    run(gate, tail, 2.0);

    CHECK(!gate.isOpen());
    CHECK(gate.gainForTest() <= dbToAmp(-89.0f));
}

static void the_gate_holds_for_10_ms_before_it_starts_to_close() {
    GateProcessor gate;
    prepared(gate, -40.0f);  // open, envelope 0: below the close point from sample one

    const int hold = static_cast<int>(GateProcessor::kHoldMs * kRate / 1000.0);  // 480
    float sample[1];
    for (int i = 0; i < hold - 1; ++i) {
        sample[0] = 0.0f;
        gate.process(sample, 1);
        CHECK(gate.gainForTest() == 1.0f);
    }
    for (int i = 0; i < 20; ++i) {
        sample[0] = 0.0f;
        gate.process(sample, 1);
    }

    CHECK(!gate.isOpen());
    CHECK(gate.gainForTest() < 1.0f);
}

static void the_minimum_threshold_never_closes() {
    GateProcessor gate;
    prepared(gate, GateProcessor::kThresholdMinDb);

    Sine silence{0.0f};
    run(gate, silence, 2.0);
    CHECK(gate.isOpen());
    CHECK(gate.gainForTest() == 1.0f);

    // Below the range, and a NaN, must fail open rather than mute.
    setThreshold(gate, -200.0f);
    run(gate, silence, 1.0);
    CHECK(gate.isOpen());

    setThreshold(gate, std::numeric_limits<float>::quiet_NaN());
    run(gate, silence, 1.0);
    CHECK(gate.isOpen());
    CHECK(gate.gainForTest() == 1.0f);
}

static void a_long_silence_flushes_the_envelope_to_zero() {
    GateProcessor gate;
    prepared(gate, -40.0f);

    Sine loud{0.5f};
    run(gate, loud, 0.1);

    Sine silence{0.0f};
    const float peak = run(gate, silence, 5.0);

    CHECK_FINITE(peak);
    CHECK(peak == 0.0f);
    // Exactly zero, not a denormal decaying forever (spec §5.3 rule 4).
    CHECK(gate.envelopeForTest() == 0.0f);
}

static void a_sample_above_the_close_point_restarts_the_hold() {
    GateProcessor gate;
    prepared(gate, -40.0f);  // open, envelope 0: closes below -46 dB after a 480-sample hold

    const int hold = static_cast<int>(GateProcessor::kHoldMs * kRate / 1000.0);  // 480
    float sample[1];

    // ~400 samples of silence: inside the hold, well short of closing on its own.
    for (int i = 0; i < 400; ++i) {
        sample[0] = 0.0f;
        gate.process(sample, 1);
    }
    CHECK(gate.isOpen());

    // One sample above the close point (-46 dB) but below the open point
    // (-40 dB) restarts the hold. The envelope's 10 ms fall then keeps it
    // above the close point for a while as it decays back down.
    sample[0] = dbToAmp(-43.0f);
    gate.process(sample, 1);
    CHECK(gate.isOpen());

    // Continue with silence. A gate that did NOT restart the hold would have
    // closed at sample 480 -- 80 samples from here. Confirm it is still open
    // well past that point (500 total: only 100 samples since the restart,
    // short of a fresh 480-sample hold).
    for (int i = 0; i < 99; ++i) {
        sample[0] = 0.0f;
        gate.process(sample, 1);
    }
    CHECK(gate.isOpen());
    CHECK(gate.gainForTest() == 1.0f);

    // It does eventually close, once the restarted hold plus the envelope's
    // own decay have both run out.
    for (int i = 0; i < hold * 2; ++i) {
        sample[0] = 0.0f;
        gate.process(sample, 1);
    }
    CHECK(!gate.isOpen());
}

static void reset_reopens_the_gate() {
    GateProcessor gate;
    prepared(gate, -40.0f);

    Sine silence{0.0f};
    run(gate, silence, 2.0);
    CHECK(!gate.isOpen());

    gate.reset();
    CHECK(gate.isOpen());

    // Engaging never swallows the first note: the very first sample passes at unity.
    float buffer[kBlock];
    for (int i = 0; i < kBlock; ++i) buffer[i] = 0.1f;
    gate.process(buffer, kBlock);
    CHECK(buffer[0] == 0.1f);
}

static void run_tests() {
    a_signal_above_threshold_opens_the_gate_and_passes_at_unity();
    a_signal_below_threshold_closes_the_gate_to_the_floor();
    silence_closes_the_gate();
    an_open_gate_holds_open_inside_the_hysteresis_band();
    a_closed_gate_stays_closed_inside_the_hysteresis_band();
    a_signal_below_the_hysteresis_band_closes_an_open_gate();
    the_gate_holds_for_10_ms_before_it_starts_to_close();
    the_minimum_threshold_never_closes();
    a_long_silence_flushes_the_envelope_to_zero();
    a_sample_above_the_close_point_restarts_the_hold();
    reset_reopens_the_gate();
}

TEST_MAIN("GateProcessor")

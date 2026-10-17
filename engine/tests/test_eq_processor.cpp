#include "EqProcessor.h"
#include "test_util.h"

#include <complex>

namespace {

constexpr double kPi = 3.14159265358979323846;

// |H(e^{jw})| for a normalised biquad.
double magnitudeAt(const BiquadCoeffs& c, double freqHz, double sampleRate) {
    const double w = 2.0 * kPi * freqHz / sampleRate;
    const std::complex<double> z1 = std::polar(1.0, -w);
    const std::complex<double> z2 = std::polar(1.0, -2.0 * w);
    const std::complex<double> num = c.b0 + c.b1 * z1 + c.b2 * z2;
    const std::complex<double> den = 1.0 + c.a1 * z1 + c.a2 * z2;
    return std::abs(num / den);
}

double dbToGain(double db) { return std::pow(10.0, db / 20.0); }

}  // namespace

static void coefficients_are_finite_across_the_whole_range_at_both_rates() {
    for (const double sr : {44100.0, 48000.0}) {
        for (double db = -12.0; db <= 12.0 + 1e-9; db += 0.5) {
            const BiquadCoeffs low = makeLowShelf(EqProcessor::kBassFreq, sr, db);
            const BiquadCoeffs mid = makePeaking(EqProcessor::kMidFreq, EqProcessor::kMidQ, sr, db);
            const BiquadCoeffs high = makeHighShelf(EqProcessor::kTrebleFreq, sr, db);
            for (const BiquadCoeffs& c : {low, mid, high}) {
                CHECK_FINITE(c.b0);
                CHECK_FINITE(c.b1);
                CHECK_FINITE(c.b2);
                CHECK_FINITE(c.a1);
                CHECK_FINITE(c.a2);
                // Poles inside the unit circle: |a2| < 1 and |a1| < 1 + a2.
                CHECK(std::fabs(c.a2) < 1.0);
                CHECK(std::fabs(c.a1) < 1.0 + c.a2 + 1e-9);
            }
        }
    }
}

static void the_peaking_band_hits_its_target_gain_at_its_centre_frequency() {
    for (const double sr : {44100.0, 48000.0}) {
        for (const double db : {-12.0, -6.0, -3.0, 3.0, 6.0, 12.0}) {
            const BiquadCoeffs c = makePeaking(EqProcessor::kMidFreq, EqProcessor::kMidQ, sr, db);
            CHECK_CLOSE(magnitudeAt(c, EqProcessor::kMidFreq, sr), dbToGain(db), 1e-6);
        }
    }
}

static void the_low_shelf_hits_its_target_gain_at_dc() {
    for (const double sr : {44100.0, 48000.0}) {
        for (const double db : {-12.0, -6.0, 6.0, 12.0}) {
            const BiquadCoeffs c = makeLowShelf(EqProcessor::kBassFreq, sr, db);
            CHECK_CLOSE(magnitudeAt(c, 0.0, sr), dbToGain(db), 1e-6);
            // ...and leaves the top end alone.
            CHECK_CLOSE(magnitudeAt(c, sr / 2.0, sr), 1.0, 1e-6);
        }
    }
}

static void the_high_shelf_hits_its_target_gain_at_nyquist() {
    for (const double sr : {44100.0, 48000.0}) {
        for (const double db : {-12.0, -6.0, 6.0, 12.0}) {
            const BiquadCoeffs c = makeHighShelf(EqProcessor::kTrebleFreq, sr, db);
            CHECK_CLOSE(magnitudeAt(c, sr / 2.0, sr), dbToGain(db), 1e-6);
            CHECK_CLOSE(magnitudeAt(c, 0.0, sr), 1.0, 1e-6);
        }
    }
}

static void zero_db_is_flat_for_every_band() {
    const double sr = 48000.0;
    for (const double f : {20.0, 100.0, 440.0, 800.0, 3200.0, 10000.0, 20000.0}) {
        CHECK_CLOSE(magnitudeAt(makeLowShelf(EqProcessor::kBassFreq, sr, 0.0), f, sr), 1.0, 1e-6);
        CHECK_CLOSE(magnitudeAt(makePeaking(EqProcessor::kMidFreq, EqProcessor::kMidQ, sr, 0.0), f, sr), 1.0, 1e-6);
        CHECK_CLOSE(magnitudeAt(makeHighShelf(EqProcessor::kTrebleFreq, sr, 0.0), f, sr), 1.0, 1e-6);
    }
}

static void flat_settings_pass_the_signal_through() {
    EqProcessor eq;
    eq.prepare(48000.0, 128);

    const float flat[4] = {0.0f, 0.0f, 0.0f, 0.0f};
    float buffer[128];
    for (int i = 0; i < 128; ++i) buffer[i] = 0.25f;

    eq.setParams(flat);
    eq.process(buffer, 128);

    // A flat EQ is three unity biquads: the signal comes out as it went in.
    for (int i = 0; i < 128; ++i) CHECK_CLOSE(buffer[i], 0.25f, 1e-5);
}

static void a_boost_raises_the_level_and_stays_finite() {
    EqProcessor eq;
    eq.prepare(48000.0, 128);

    const float boost[4] = {12.0f, 0.0f, 0.0f, 0.0f};
    float peak = 0.0f;

    // Feed 20 Hz — well below the 100 Hz corner, so the shelf is on its
    // plateau and the expected gain is close to the full +12 dB.
    double phase = 0.0;
    const double increment = 2.0 * kPi * 20.0 / 48000.0;

    for (int block = 0; block < 200; ++block) {
        float buffer[128];
        for (int i = 0; i < 128; ++i) {
            buffer[i] = static_cast<float>(std::sin(phase));
            phase += increment;
        }
        eq.setParams(boost);
        eq.process(buffer, 128);
        if (block > 150) {
            for (int i = 0; i < 128; ++i) {
                CHECK_FINITE(buffer[i]);
                if (std::fabs(buffer[i]) > peak) peak = std::fabs(buffer[i]);
            }
        }
    }

    // +12 dB is 3.98x at DC and a little less at 20 Hz. This is a smoke check,
    // not a response measurement — the coefficient tests above are that.
    CHECK(peak > 3.2f);
    CHECK(peak < 4.1f);
}

// The DC-at-20Hz boost test above catches a bass<->treble swap (bass moves
// the low end, treble does not), but says nothing about mid and treble being
// transposed — both are boostable bands that leave 20 Hz alone. Feed each
// band its own frequency (800 Hz for mid — EqProcessor::kMidFreq, the exact
// peak of that band's peaking filter; 10 kHz for treble — off the 3200 Hz
// shelf corner and onto its plateau, the same reason the bass test uses
// 20 Hz rather than the 100 Hz corner) and confirm it, specifically, is what
// moved.
static void a_mid_boost_raises_800hz_and_a_treble_boost_raises_10khz() {
    const float midBoost[4] = {0.0f, 12.0f, 0.0f, 0.0f};
    const float trebleBoost[4] = {0.0f, 0.0f, 12.0f, 0.0f};

    for (const auto& params : {std::pair<const float*, double>{midBoost, 800.0},
                                std::pair<const float*, double>{trebleBoost, 10000.0}}) {
        const float* boost = params.first;
        const double freqHz = params.second;

        EqProcessor eq;
        eq.prepare(48000.0, 128);
        float peak = 0.0f;

        double phase = 0.0;
        const double increment = 2.0 * kPi * freqHz / 48000.0;

        // Same settling convention as the bass boost test: the per-block
        // smoother needs ~165 blocks to converge, so run 200 and measure the
        // last 50.
        for (int block = 0; block < 200; ++block) {
            float buffer[128];
            for (int i = 0; i < 128; ++i) {
                buffer[i] = static_cast<float>(std::sin(phase));
                phase += increment;
            }
            eq.setParams(boost);
            eq.process(buffer, 128);
            if (block > 150) {
                for (int i = 0; i < 128; ++i) {
                    CHECK_FINITE(buffer[i]);
                    if (std::fabs(buffer[i]) > peak) peak = std::fabs(buffer[i]);
                }
            }
        }

        // +12 dB is 3.98x. A transposed mid/treble would instead measure
        // close to unity gain here (its own +12 dB sitting on a frequency
        // this band leaves alone).
        CHECK(peak > 3.2f);
        CHECK(peak < 4.1f);
    }
}

static void reset_clears_filter_state() {
    EqProcessor eq;
    eq.prepare(48000.0, 128);

    const float boost[4] = {12.0f, 12.0f, 12.0f, 0.0f};
    float buffer[128];
    for (int i = 0; i < 128; ++i) buffer[i] = 1.0f;
    eq.setParams(boost);
    eq.process(buffer, 128);

    eq.reset();

    float silence[128] = {};
    eq.setParams(boost);
    eq.process(silence, 128);

    // With cleared state, silence in is silence out.
    for (int i = 0; i < 128; ++i) CHECK(silence[i] == 0.0f);
}

static void the_level_scales_the_output_after_the_bands() {
    EqProcessor eq;
    eq.prepare(48000.0, 128);
    const float params[4] = {0.0f, 0.0f, 0.0f, 6.0f};
    eq.setParams(params);

    float buffer[128];
    // 100 quanta is ~267 ms, far past the 20 ms glide.
    for (int block = 0; block < 100; ++block) {
        for (int i = 0; i < 128; ++i) buffer[i] = 0.25f;
        eq.process(buffer, 128);
    }

    CHECK_CLOSE(buffer[127], 0.25 * 1.995262, 1e-3);  // +6 dB
}

static void the_level_glides_rather_than_steps() {
    EqProcessor eq;
    eq.prepare(48000.0, 128);
    const float loud[4] = {0.0f, 0.0f, 0.0f, 12.0f};
    eq.setParams(loud);

    float buffer[128];
    for (int i = 0; i < 128; ++i) buffer[i] = 1.0f;
    eq.process(buffer, 128);

    // One quantum into a 20 ms glide from unity toward ~3.98: it starts at
    // unity (no fade-in from silence), rises within the block, and is still
    // far from the target — a step would put every sample at ~3.98.
    CHECK(buffer[0] < 1.1f);
    CHECK(buffer[127] > buffer[0]);
    CHECK(buffer[127] < 3.0f);
}

static void run_tests() {
    coefficients_are_finite_across_the_whole_range_at_both_rates();
    the_peaking_band_hits_its_target_gain_at_its_centre_frequency();
    the_low_shelf_hits_its_target_gain_at_dc();
    the_high_shelf_hits_its_target_gain_at_nyquist();
    zero_db_is_flat_for_every_band();
    flat_settings_pass_the_signal_through();
    a_boost_raises_the_level_and_stays_finite();
    a_mid_boost_raises_800hz_and_a_treble_boost_raises_10khz();
    reset_clears_filter_state();
    the_level_scales_the_output_after_the_bands();
    the_level_glides_rather_than_steps();
}

TEST_MAIN("EqProcessor")

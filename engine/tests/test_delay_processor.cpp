#include "DelayProcessor.h"
#include "test_util.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <vector>

namespace {

constexpr double kRate = 48000.0;
constexpr int kBlock = 128;

void configure(DelayProcessor& d, float level, float timeMs, float feedback) {
    const float params[3] = {level, timeMs, feedback};
    d.setParams(params);
}

std::vector<float> impulse(size_t length) {
    std::vector<float> in(length, 0.0f);
    in[0] = 1.0f;
    return in;
}

/** Processes `data` in blocks of `block` (the last one may be shorter). */
std::vector<float> run(DelayProcessor& d, std::vector<float> data, int block = kBlock) {
    for (size_t start = 0; start < data.size(); start += static_cast<size_t>(block)) {
        const int n = static_cast<int>(std::min<size_t>(static_cast<size_t>(block), data.size() - start));
        d.process(data.data() + start, n);
    }
    return data;
}

}  // namespace

static void an_impulse_returns_at_exactly_the_set_time() {
    DelayProcessor d;
    d.prepare(kRate, kBlock);
    configure(d, 100.0f, 20.0f, 0.0f);  // 20 ms = 960 samples

    const auto out = run(d, impulse(2000));

    CHECK_CLOSE(out[0], 1.0, 1e-6);  // the dry signal, untouched
    CHECK_CLOSE(out[960], 1.0, 1e-6);
    for (size_t i = 1; i < out.size(); ++i) {
        if (i != 960) CHECK_CLOSE(out[i], 0.0, 1e-6);
    }
}

static void a_fractional_time_is_interpolated_between_two_samples() {
    DelayProcessor d;
    d.prepare(kRate, kBlock);
    configure(d, 100.0f, 20.01f, 0.0f);  // 960.48 samples

    const auto out = run(d, impulse(2000));

    CHECK_CLOSE(out[959], 0.0, 1e-3);
    CHECK_CLOSE(out[960], 0.52, 1e-3);
    CHECK_CLOSE(out[961], 0.48, 1e-3);
    CHECK_CLOSE(out[962], 0.0, 1e-3);
}

static void successive_repeats_fall_by_the_feedback_ratio() {
    DelayProcessor d;
    d.prepare(kRate, kBlock);
    configure(d, 100.0f, 20.0f, 50.0f);  // 960 samples, half of each repeat fed back

    const auto out = run(d, impulse(4400));

    CHECK_CLOSE(out[960], 1.0, 1e-6);
    CHECK_CLOSE(out[1920], 0.5, 1e-6);
    CHECK_CLOSE(out[2880], 0.25, 1e-6);
    CHECK_CLOSE(out[3840], 0.125, 1e-6);
}

static void level_scales_the_repeats_and_leaves_the_dry_signal_alone() {
    DelayProcessor d;
    d.prepare(kRate, kBlock);
    configure(d, 50.0f, 20.0f, 0.0f);

    const auto out = run(d, impulse(1200));

    CHECK_CLOSE(out[0], 1.0, 1e-6);
    CHECK_CLOSE(out[960], 0.5, 1e-6);
}

static void a_level_of_zero_makes_the_repeats_silent() {
    DelayProcessor d;
    d.prepare(kRate, kBlock);
    configure(d, 0.0f, 20.0f, 50.0f);

    const auto out = run(d, impulse(1200));

    CHECK_CLOSE(out[0], 1.0, 1e-6);
    for (size_t i = 1; i < out.size(); ++i) CHECK_CLOSE(out[i], 0.0, 1e-6);
}

static void maximum_feedback_decays_and_never_grows() {
    DelayProcessor d;
    d.prepare(kRate, kBlock);
    configure(d, 100.0f, 20.0f, 90.0f);

    std::vector<float> in(480000, 0.0f);  // ten seconds
    in[0] = 1.0f;
    const auto out = run(d, in);

    float peak = 0.0f;
    for (float v : out) peak = std::max(peak, std::fabs(v));
    CHECK(peak <= 1.0f + 1e-6f);

    // 0.9^437 is below the flush threshold, so over the last half second the
    // tail has decayed to exact zeros rather than lingering in denormals.
    float tail = 0.0f;
    for (size_t i = out.size() - 24000; i < out.size(); ++i) tail = std::max(tail, std::fabs(out[i]));
    CHECK(tail == 0.0f);
}

static void the_time_is_clamped_to_the_supported_range() {
    {
        DelayProcessor d;
        d.prepare(kRate, kBlock);
        configure(d, 100.0f, 5000.0f, 0.0f);  // far over the 1000 ms maximum
        const auto out = run(d, impulse(48100));
        CHECK_CLOSE(out[48000], 1.0, 1e-6);
    }
    {
        DelayProcessor d;
        d.prepare(kRate, kBlock);
        configure(d, 100.0f, 1.0f, 0.0f);  // under the 20 ms minimum
        const auto out = run(d, impulse(2000));
        CHECK_CLOSE(out[960], 1.0, 1e-6);
    }
}

static void non_finite_params_are_read_as_safe_values() {
    DelayProcessor d;
    d.prepare(kRate, kBlock);
    const float nan = std::numeric_limits<float>::quiet_NaN();
    const float inf = std::numeric_limits<float>::infinity();
    configure(d, nan, inf, nan);  // level and feedback 0, time the default

    std::vector<float> in(5000);
    for (size_t i = 0; i < in.size(); ++i) in[i] = std::sin(static_cast<float>(i) * 0.05f);
    const auto out = run(d, in);

    for (size_t i = 0; i < out.size(); ++i) {
        CHECK_FINITE(out[i]);
        CHECK_CLOSE(out[i], in[i], 1e-6);  // level 0: dry only
    }
}

static void a_non_finite_input_sample_cannot_poison_the_loop() {
    const float bad[] = {std::numeric_limits<float>::quiet_NaN(), std::numeric_limits<float>::infinity(),
                         -std::numeric_limits<float>::infinity()};
    const float settings[][3] = {{100.0f, 20.0f, 90.0f}, {30.0f, 20.0f, 35.0f}, {30.0f, 333.33f, 35.0f}};
    for (float badValue : bad) {
        for (const auto& s : settings) {
            DelayProcessor d;
            d.prepare(kRate, kBlock);
            configure(d, s[0], s[1], s[2]);

            std::vector<float> in(static_cast<size_t>(kRate * 12), 0.25f);
            in[10] = badValue;
            const auto out = run(d, in);

            for (float v : out) CHECK_FINITE(v);
        }
    }
}

static void reset_clears_the_line() {
    DelayProcessor d;
    d.prepare(kRate, kBlock);
    configure(d, 100.0f, 20.0f, 0.0f);

    run(d, impulse(100));  // the repeat is 960 samples away
    d.reset();
    const auto out = run(d, std::vector<float>(1000, 0.0f));

    for (float v : out) CHECK_CLOSE(v, 0.0, 1e-9);
}

static void the_first_params_after_a_reset_take_effect_at_once() {
    DelayProcessor d;
    d.prepare(kRate, kBlock);
    configure(d, 0.0f, 350.0f, 0.0f);  // stale values, as after a long bypass
    d.reset();
    configure(d, 100.0f, 20.0f, 0.0f);  // what the user actually has set

    const auto out = run(d, impulse(2000));

    // Smoothing from the stale 350 ms would put the repeat far from sample 960.
    CHECK_CLOSE(out[960], 1.0, 1e-6);
}

static void the_line_and_limit_follow_the_sample_rate() {
    {
        DelayProcessor d;
        d.prepare(44100.0, kBlock);
        CHECK(d.maxDelaySamples() == 44100);
    }
    {
        DelayProcessor d;
        d.prepare(48000.0, kBlock);
        CHECK(d.maxDelaySamples() == DelayProcessor::kMaxDelaySamples);
    }
    {
        // Above 48 kHz the longest time shrinks to fit the fixed line.
        DelayProcessor d;
        d.prepare(96000.0, kBlock);
        CHECK(d.maxDelaySamples() == DelayProcessor::kMaxDelaySamples);
        configure(d, 100.0f, 1000.0f, 0.0f);
        const auto out = run(d, impulse(60000));
        CHECK_CLOSE(out[48000], 1.0, 1e-6);
        for (float v : out) CHECK_FINITE(v);
    }
}

// 14400 samples is the 100 -> 400 ms change. An odd multiple of pi/14400 puts the
// input exactly half a period out of phase across that shift, so a hard jump in
// the delay flips the repeat's sign (a step near 1.0) instead of landing almost
// in phase and hiding.
constexpr float kGlideOmega = 265.0f * 3.14159265358979f / 14400.0f;

static void changing_the_time_glides_instead_of_jumping() {
    DelayProcessor d;
    d.prepare(kRate, kBlock);
    configure(d, 100.0f, 100.0f, 0.0f);

    std::vector<float> in(60000);
    for (size_t i = 0; i < in.size(); ++i) in[i] = 0.5f * std::sin(static_cast<float>(i) * kGlideOmega);

    std::vector<float> out(in.size());
    std::copy(in.begin(), in.end(), out.begin());
    d.process(out.data(), 30000);
    configure(d, 100.0f, 400.0f, 0.0f);  // a big jump in the setting
    d.process(out.data() + 30000, 30000);

    // A sample-to-sample step in the repeat above this would be a click. The
    // sine's own steepest step is ~0.03; gliding the delay stretches or
    // squeezes it several-fold, never to a jump (a hard jump gives ~1.0).
    float worst = 0.0f;
    for (size_t i = 30000; i < out.size(); ++i) {
        const float wet = out[i] - in[i];
        const float previous = out[i - 1] - in[i - 1];
        worst = std::max(worst, std::fabs(wet - previous));
    }
    CHECK(worst < 0.3f);
}

static void run_tests() {
    an_impulse_returns_at_exactly_the_set_time();
    a_fractional_time_is_interpolated_between_two_samples();
    successive_repeats_fall_by_the_feedback_ratio();
    level_scales_the_repeats_and_leaves_the_dry_signal_alone();
    a_level_of_zero_makes_the_repeats_silent();
    maximum_feedback_decays_and_never_grows();
    the_time_is_clamped_to_the_supported_range();
    non_finite_params_are_read_as_safe_values();
    a_non_finite_input_sample_cannot_poison_the_loop();
    reset_clears_the_line();
    the_first_params_after_a_reset_take_effect_at_once();
    the_line_and_limit_follow_the_sample_rate();
    changing_the_time_glides_instead_of_jumping();
}

TEST_MAIN("DelayProcessor")

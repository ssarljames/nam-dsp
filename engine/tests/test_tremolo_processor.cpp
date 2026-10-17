#include "TremoloProcessor.h"
#include "test_util.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <vector>

namespace {

constexpr double kRate = 48000.0;
constexpr int kBlock = 128;
constexpr double kPi = 3.141592653589793;

constexpr float kSine = 0.0f;
constexpr float kTri = 1.0f;
constexpr float kSquare = 2.0f;
constexpr float kSaw = 3.0f;

/**
 * The largest step the 2 ms edge smoother can take at 48 kHz: its coefficient,
 * 1 - exp(-1 / (0.002 x 48000)), times a move of at most 1.
 */
constexpr double kEdgeStep = 0.010363;

void configure(TremoloProcessor& t, float levelDb, float rateHz, float depth, float wave) {
    const float params[4] = {levelDb, rateHz, depth, wave};
    t.setParams(params);
}

/** Processes `data` in blocks of kBlock (the last one may be shorter). */
std::vector<float> run(TremoloProcessor& t, std::vector<float> data) {
    for (size_t start = 0; start < data.size(); start += static_cast<size_t>(kBlock)) {
        const int n = static_cast<int>(std::min<size_t>(static_cast<size_t>(kBlock), data.size() - start));
        t.process(data.data() + start, n);
    }
    return data;
}

/**
 * Like run(), but calls setParams(`later`) at sample `at`, splitting the block
 * there so the change lands on exactly that sample.
 */
std::vector<float> runWithChange(TremoloProcessor& t, std::vector<float> data, size_t at, const float* later) {
    size_t start = 0;
    while (start < data.size()) {
        if (start == at) t.setParams(later);
        size_t end = std::min(start + static_cast<size_t>(kBlock), data.size());
        if (start < at && at < end) end = at;
        t.process(data.data() + start, static_cast<int32_t>(end - start));
        start = end;
    }
    return data;
}

std::vector<float> constant(size_t length, float value) { return std::vector<float>(length, value); }

size_t samples(double seconds, double sampleRate = kRate) {
    return static_cast<size_t>(std::lround(seconds * sampleRate));
}

/** A fresh tremolo's output for a steady input of 1.0: the gain curve itself. */
std::vector<float> gainCurve(float levelDb, float rateHz, float depth, float wave, double seconds,
                             double sampleRate = kRate) {
    TremoloProcessor t;
    t.prepare(sampleRate, kBlock);
    configure(t, levelDb, rateHz, depth, wave);
    return run(t, constant(samples(seconds, sampleRate), 1.0f));
}

/** The largest sample-to-sample step in `x` from index `from` to `to`. */
double largestStep(const std::vector<float>& x, size_t from = 1, size_t to = SIZE_MAX) {
    double largest = 0.0;
    to = std::min(to, x.size());
    for (size_t i = std::max<size_t>(from, 1); i < to; ++i) {
        largest = std::max(largest, std::fabs(static_cast<double>(x[i]) - static_cast<double>(x[i - 1])));
    }
    return largest;
}

/**
 * The mean period, in seconds, between upward crossings of `threshold`, each
 * placed between samples by linear interpolation. Zero if fewer than two.
 */
double meanPeriod(const std::vector<float>& x, double threshold, double sampleRate) {
    std::vector<double> crossings;
    for (size_t i = 1; i < x.size(); ++i) {
        const double a = x[i - 1];
        const double b = x[i];
        if (a < threshold && b >= threshold) crossings.push_back(static_cast<double>(i - 1) + (threshold - a) / (b - a));
    }
    if (crossings.size() < 2) return 0.0;
    return (crossings.back() - crossings.front()) / static_cast<double>(crossings.size() - 1) / sampleRate;
}

double minOf(const std::vector<float>& x, size_t from = 0) {
    return *std::min_element(x.begin() + static_cast<std::ptrdiff_t>(from), x.end());
}

double maxOf(const std::vector<float>& x, size_t from = 0) {
    return *std::max_element(x.begin() + static_cast<std::ptrdiff_t>(from), x.end());
}

// --- Tests ---------------------------------------------------------------------

void with_no_depth_the_input_passes_unchanged_at_every_wave() {
    for (float wave : {kSine, kTri, kSquare, kSaw}) {
        TremoloProcessor t;
        t.prepare(kRate, kBlock);
        configure(t, 0.0f, 4.0f, 0.0f, wave);
        std::vector<float> in(samples(0.5));
        for (size_t i = 0; i < in.size(); ++i) in[i] = static_cast<float>(0.5 * std::sin(2.0 * kPi * 220.0 * i / kRate));
        const auto out = run(t, in);
        double worst = 0.0;
        for (size_t i = 0; i < in.size(); ++i) worst = std::max(worst, std::fabs(static_cast<double>(out[i] - in[i])));
        CHECK(worst < 1e-7);
    }
}

void level_trims_the_output() {
    // 10^(6/20) and 10^(-24/20).
    const auto up = gainCurve(6.0f, 4.0f, 0.0f, kSine, 0.1);
    CHECK_CLOSE(up.back(), 1.995262, 1e-4);
    const auto down = gainCurve(-24.0f, 4.0f, 0.0f, kSine, 0.1);
    CHECK_CLOSE(down.back(), 0.063096, 1e-5);
}

void the_sine_follows_a_raised_cosine() {
    // At 1 Hz and DEPTH 100 % the gain is 1 - (0.5 - 0.5 cos 2 pi t), lagged
    // by at most the 2 ms smoother: within pi x 0.002 of the formula.
    const auto g = gainCurve(0.0f, 1.0f, 100.0f, kSine, 1.0);
    double worst = 0.0;
    for (size_t i = 0; i < g.size(); ++i) {
        const double expected = 0.5 + 0.5 * std::cos(2.0 * kPi * static_cast<double>(i) / kRate);
        worst = std::max(worst, std::fabs(g[i] - expected));
    }
    CHECK(worst < 0.01);
    CHECK_CLOSE(g[0], 1.0, 1e-6);  // it starts at the top of the wave
}

void the_triangle_falls_and_rises_in_straight_lines() {
    const auto g = gainCurve(0.0f, 1.0f, 100.0f, kTri, 1.0);
    double worst = 0.0;
    for (size_t i = 0; i < g.size(); ++i) {
        const double phase = static_cast<double>(i) / kRate;
        const double expected = phase < 0.5 ? 1.0 - 2.0 * phase : 2.0 * phase - 1.0;
        worst = std::max(worst, std::fabs(g[i] - expected));
    }
    CHECK(worst < 0.01);
}

void the_square_is_on_for_half_the_cycle_and_off_for_the_other() {
    const auto g = gainCurve(0.0f, 1.0f, 100.0f, kSquare, 2.0);
    // Away from the edges by 20 ms (ten time constants), it has settled.
    for (int cycle = 0; cycle < 2; ++cycle) {
        const double base = static_cast<double>(cycle);
        const size_t topFrom = samples(base + (cycle == 0 ? 0.0 : 0.02));
        CHECK(minOf(std::vector<float>(g.begin() + static_cast<std::ptrdiff_t>(topFrom),
                                       g.begin() + static_cast<std::ptrdiff_t>(samples(base + 0.49)))) > 0.999);
        CHECK(maxOf(std::vector<float>(g.begin() + static_cast<std::ptrdiff_t>(samples(base + 0.52)),
                                       g.begin() + static_cast<std::ptrdiff_t>(samples(base + 0.99)))) < 0.001);
    }
}

void the_saw_swells_up_over_the_cycle_then_drops() {
    const auto g = gainCurve(0.0f, 1.0f, 100.0f, kSaw, 2.0);
    double worst = 0.0;
    for (size_t i = 0; i < g.size(); ++i) {
        const double t = static_cast<double>(i) / kRate;
        const double phase = t - std::floor(t);
        // Skip the 20 ms after each drop, where the smoother is still falling.
        if (t > 0.5 && phase < 0.02) continue;
        worst = std::max(worst, std::fabs(g[i] - phase));
    }
    CHECK(worst < 0.01);
    CHECK_CLOSE(g[0], 0.0, 1e-6);           // the start of the swell
    CHECK(g[samples(0.99)] > 0.98);          // nearly at the top
    CHECK(g[samples(1.0) + 480] < 0.03);     // 10 ms after the drop: back at the start
}

void depth_sets_the_bottom_of_the_wave() {
    const auto square = gainCurve(0.0f, 1.0f, 30.0f, kSquare, 1.0);
    CHECK_CLOSE(square[samples(0.25)], 1.0, 1e-4);
    CHECK_CLOSE(square[samples(0.75)], 0.7, 1e-4);

    const auto sine = gainCurve(0.0f, 2.0f, 50.0f, kSine, 1.0);
    CHECK_CLOSE(maxOf(sine), 1.0, 1e-3);
    CHECK_CLOSE(minOf(sine), 0.5, 2e-3);
}

void the_period_matches_the_rate() {
    for (float rate : {0.5f, 4.0f, 15.0f}) {
        const auto g = gainCurve(0.0f, rate, 100.0f, kSine, 6.5);
        CHECK_CLOSE(meanPeriod(g, 0.5, kRate), 1.0 / rate, 0.01 / rate);
    }
}

void the_square_and_saw_chop_without_steps_larger_than_the_smoother() {
    for (float wave : {kSquare, kSaw}) {
        const auto g = gainCurve(0.0f, 15.0f, 100.0f, wave, 1.0);
        CHECK(largestStep(g) <= kEdgeStep + 1e-5);
        CHECK(maxOf(g, samples(0.5)) > 0.95);
    }
    // ...and they really chop. The square reaches silence every cycle. The saw
    // cannot quite: while its drop is being smoothed the next swell has begun,
    // so its floor is r tau ln(1 / (r tau)), tau = 2 ms: 0.039 at 4 Hz, 0.105
    // at 15 Hz. A smoother that let it reach zero would be a click.
    CHECK(minOf(gainCurve(0.0f, 15.0f, 100.0f, kSquare, 1.0), samples(0.5)) < 0.001);
    CHECK(minOf(gainCurve(0.0f, 15.0f, 100.0f, kSaw, 1.0), samples(0.5)) < 0.11);
    CHECK(minOf(gainCurve(0.0f, 4.0f, 100.0f, kSaw, 2.0), samples(0.5)) < 0.04);
}

void a_wave_change_never_clicks() {
    // SQUARE at 4 Hz sits at its bottom from phase 0.5 to 1. At phase 0.95 of
    // the second cycle, switch to SINE, whose gain there is nearly 1: the
    // worst jump a wave change can ask for.
    TremoloProcessor t;
    t.prepare(kRate, kBlock);
    configure(t, 0.0f, 4.0f, 100.0f, kSquare);
    const size_t at = samples((1.0 + 0.95) / 4.0);
    const float sine[4] = {0.0f, 4.0f, 100.0f, kSine};
    const auto g = runWithChange(t, constant(samples(0.6), 1.0f), at, sine);
    CHECK(g[at - 1] < 0.01);
    CHECK(g[at + samples(0.02)] > 0.95);
    CHECK(largestStep(g, at - 10, at + samples(0.03)) <= kEdgeStep + 1e-5);
}

void changing_the_rate_keeps_the_wave_continuous() {
    // A sine at 15 Hz moves by at most pi x 15 / 48000 per sample; a phase
    // that jumped when the rate changed would step far further.
    TremoloProcessor t;
    t.prepare(kRate, kBlock);
    configure(t, 0.0f, 1.0f, 100.0f, kSine);
    const float fast[4] = {0.0f, 15.0f, 100.0f, kSine};
    const auto g = runWithChange(t, constant(samples(1.3), 1.0f), samples(0.37), fast);
    CHECK(largestStep(g) < 0.002);
    // ...and the new rate does arrive.
    CHECK_CLOSE(meanPeriod(std::vector<float>(g.begin() + static_cast<std::ptrdiff_t>(samples(0.8)), g.end()), 0.5, kRate),
                1.0 / 15.0, 0.01 / 15.0);
}

void changing_the_level_or_depth_glides_instead_of_jumping() {
    {
        TremoloProcessor t;
        t.prepare(kRate, kBlock);
        configure(t, 0.0f, 4.0f, 0.0f, kSine);
        const float louder[4] = {12.0f, 4.0f, 0.0f, kSine};
        const size_t at = samples(0.1);
        const auto g = runWithChange(t, constant(samples(0.5), 1.0f), at, louder);
        CHECK(g[at] < 1.1);                       // not 3.98 at once
        CHECK_CLOSE(g.back(), 3.981072, 1e-3);    // 10^(12/20), once it has glided
    }
    {
        TremoloProcessor t;
        t.prepare(kRate, kBlock);
        configure(t, 0.0f, 1.0f, 0.0f, kSquare);
        const float deep[4] = {0.0f, 1.0f, 100.0f, kSquare};
        const size_t at = samples(0.75);          // the bottom half of the square
        const auto g = runWithChange(t, constant(samples(0.95), 1.0f), at, deep);
        CHECK(g[at] > 0.9);                       // not 0 at once
        CHECK(g.back() < 0.01);
    }
}

void non_finite_params_read_as_the_defaults() {
    const float nan = std::numeric_limits<float>::quiet_NaN();
    const float inf = std::numeric_limits<float>::infinity();
    // The defaults: 0 dB, 4 Hz, 50 %, SINE. +inf must not read as the maximum.
    for (float bad : {nan, inf, -inf}) {
        const auto g = gainCurve(bad, bad, bad, bad, 1.0);
        for (float v : g) CHECK_FINITE(v);
        CHECK_CLOSE(maxOf(g), 1.0, 1e-3);
        CHECK_CLOSE(minOf(g), 0.5, 2e-3);
        CHECK_CLOSE(meanPeriod(g, 0.75, kRate), 0.25, 0.0025);
    }
}

void params_are_clamped_to_their_ranges() {
    CHECK_CLOSE(gainCurve(100.0f, 4.0f, 0.0f, kSine, 0.1).back(), 15.848932, 1e-2);   // +24 dB
    CHECK_CLOSE(gainCurve(-100.0f, 4.0f, 0.0f, kSine, 0.1).back(), 0.063096, 1e-5);   // -24 dB
    CHECK_CLOSE(meanPeriod(gainCurve(0.0f, 1000.0f, 100.0f, kSine, 1.0), 0.5, kRate), 1.0 / 15.0, 0.01 / 15.0);
    CHECK_CLOSE(meanPeriod(gainCurve(0.0f, -5.0f, 100.0f, kSine, 6.5), 0.5, kRate), 2.0, 0.02);
    CHECK(minOf(gainCurve(0.0f, 4.0f, 500.0f, kSine, 1.0)) < 0.002);                  // 100 %
    CHECK_CLOSE(minOf(gainCurve(0.0f, 4.0f, -50.0f, kSine, 1.0)), 1.0, 1e-6);         // 0 %
}

void the_wave_is_rounded_and_clamped() {
    // Read the wave from where each one is distinct a quarter of the way in at
    // 1 Hz: SINE 0.5, TRI 0.5 but straight, SQUARE 1, SAW 0.25. A tenth of the
    // way in tells SINE (0.905) from TRI (0.8).
    auto at = [](float wave, double phase) { return gainCurve(0.0f, 1.0f, 100.0f, wave, 1.0)[samples(phase)]; };
    CHECK_CLOSE(at(-3.0f, 0.1), 0.904508, 0.01);  // below 0: SINE
    CHECK_CLOSE(at(0.4f, 0.1), 0.904508, 0.01);   // rounds to SINE
    CHECK_CLOSE(at(1.4f, 0.1), 0.8, 0.01);        // rounds to TRI
    CHECK_CLOSE(at(2.4f, 0.25), 1.0, 0.001);      // rounds to SQUARE
    CHECK_CLOSE(at(2.6f, 0.25), 0.25, 0.01);      // rounds to SAW
    CHECK_CLOSE(at(7.0f, 0.25), 0.25, 0.01);      // above 3: SAW
}

void a_non_finite_input_sample_cannot_poison_later_output() {
    TremoloProcessor t;
    t.prepare(kRate, kBlock);
    configure(t, 0.0f, 4.0f, 50.0f, kSine);
    std::vector<float> in = constant(1000, 0.5f);
    in[100] = std::numeric_limits<float>::quiet_NaN();
    in[200] = std::numeric_limits<float>::infinity();
    in[300] = -std::numeric_limits<float>::infinity();
    const auto out = run(t, in);
    for (float v : out) CHECK_FINITE(v);
    CHECK(out[100] == 0.0f);
    CHECK(out[200] == 0.0f);
    CHECK(out[300] == 0.0f);
    CHECK(out[999] > 0.2f);
}

void reset_restarts_the_wave_at_its_top() {
    TremoloProcessor t;
    t.prepare(kRate, kBlock);
    configure(t, 0.0f, 1.0f, 100.0f, kSine);
    const auto before = run(t, constant(samples(0.5), 1.0f));
    CHECK(before.back() < 0.01);  // the bottom of the sine
    t.reset();
    configure(t, 0.0f, 1.0f, 100.0f, kSine);
    const auto after = run(t, constant(16, 1.0f));
    CHECK_CLOSE(after[0], 1.0, 1e-6);
}

void the_first_params_after_a_reset_take_effect_at_once() {
    TremoloProcessor t;
    t.prepare(kRate, kBlock);
    configure(t, 0.0f, 4.0f, 0.0f, kSine);
    run(t, constant(256, 1.0f));
    t.reset();
    configure(t, 12.0f, 1.0f, 100.0f, kSaw);
    const auto g = run(t, constant(samples(0.5), 1.0f));
    CHECK_CLOSE(g[0], 0.0, 1e-6);                         // SAW, at once
    CHECK_CLOSE(g[samples(0.25)], 3.981072 * 0.25, 0.02); // +12 dB, 1 Hz, at once
}

void it_keeps_time_at_44_1_48_and_96_khz() {
    for (double rate : {44100.0, 48000.0, 96000.0}) {
        for (float wave : {kSine, kTri, kSquare, kSaw}) {
            const auto g = gainCurve(0.0f, 15.0f, 100.0f, wave, 0.5, rate);
            for (float v : g) CHECK_FINITE(v);
        }
        CHECK_CLOSE(meanPeriod(gainCurve(0.0f, 4.0f, 100.0f, kSine, 2.0, rate), 0.5, rate), 0.25, 0.0025);
    }
}

}  // namespace

static void run_tests() {
    with_no_depth_the_input_passes_unchanged_at_every_wave();
    level_trims_the_output();
    the_sine_follows_a_raised_cosine();
    the_triangle_falls_and_rises_in_straight_lines();
    the_square_is_on_for_half_the_cycle_and_off_for_the_other();
    the_saw_swells_up_over_the_cycle_then_drops();
    depth_sets_the_bottom_of_the_wave();
    the_period_matches_the_rate();
    the_square_and_saw_chop_without_steps_larger_than_the_smoother();
    a_wave_change_never_clicks();
    changing_the_rate_keeps_the_wave_continuous();
    changing_the_level_or_depth_glides_instead_of_jumping();
    non_finite_params_read_as_the_defaults();
    params_are_clamped_to_their_ranges();
    the_wave_is_rounded_and_clamped();
    a_non_finite_input_sample_cannot_poison_later_output();
    reset_restarts_the_wave_at_its_top();
    the_first_params_after_a_reset_take_effect_at_once();
    it_keeps_time_at_44_1_48_and_96_khz();
}

TEST_MAIN("TremoloProcessor")

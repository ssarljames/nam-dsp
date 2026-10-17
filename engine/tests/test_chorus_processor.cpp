#include "ChorusProcessor.h"
#include "test_util.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <utility>
#include <vector>

namespace {

constexpr double kRate = 48000.0;
constexpr int kBlock = 128;

void configure(ChorusProcessor& c, float level, float rateHz, float depth) {
    const float params[3] = {level, rateHz, depth};
    c.setParams(params);
}

std::vector<float> impulse(size_t length) {
    std::vector<float> in(length, 0.0f);
    in[0] = 1.0f;
    return in;
}

/** Processes `data` in blocks of kBlock (the last one may be shorter). */
std::vector<float> run(ChorusProcessor& c, std::vector<float> data) {
    for (size_t start = 0; start < data.size(); start += static_cast<size_t>(kBlock)) {
        const int n = static_cast<int>(std::min<size_t>(static_cast<size_t>(kBlock), data.size() - start));
        c.process(data.data() + start, n);
    }
    return data;
}

/**
 * Like run(), but calls setParams(`later`) at sample `at`, splitting the block
 * there so the change lands on exactly that sample.
 */
std::vector<float> runWithChange(ChorusProcessor& c, std::vector<float> data, size_t at, const float* later) {
    size_t start = 0;
    while (start < data.size()) {
        if (start == at) c.setParams(later);
        size_t end = std::min(start + static_cast<size_t>(kBlock), data.size());
        if (start < at && at < end) end = at;
        c.process(data.data() + start, static_cast<int32_t>(end - start));
        start = end;
    }
    return data;
}

/** x[n] = n / sampleRate: a straight line, so a delayed copy is the line shifted. */
std::vector<float> ramp(size_t length, double sampleRate) {
    std::vector<float> x(length);
    for (size_t i = 0; i < length; ++i) x[i] = static_cast<float>(static_cast<double>(i) / sampleRate);
    return x;
}

/**
 * The delay, in samples, that turned the ramp `in` into `out`. Level must be
 * 100 %, so the copy is exactly out - in. Meaningless until the line has
 * filled; the tests read it from sample 2000 on.
 */
std::vector<double> delayOf(const std::vector<float>& in, const std::vector<float>& out, double sampleRate) {
    std::vector<double> d(in.size());
    for (size_t i = 0; i < in.size(); ++i) {
        const double wet = static_cast<double>(out[i]) - static_cast<double>(in[i]);
        d[i] = static_cast<double>(i) - wet * sampleRate;
    }
    return d;
}

std::vector<double> sweptDelay(ChorusProcessor& c, double sampleRate, size_t length) {
    const std::vector<float> in = ramp(length, sampleRate);
    return delayOf(in, run(c, in), sampleRate);
}

/** The smallest and largest value of `d` from index `from` on. */
std::pair<double, double> extent(const std::vector<double>& d, size_t from) {
    const auto mm = std::minmax_element(d.begin() + static_cast<std::ptrdiff_t>(from), d.end());
    return {*mm.first, *mm.second};
}

/** The largest sample-to-sample step in `d` from index `from` on. */
double worstStep(const std::vector<double>& d, size_t from) {
    double worst = 0.0;
    for (size_t n = from + 1; n < d.size(); ++n) worst = std::max(worst, std::fabs(d[n] - d[n - 1]));
    return worst;
}

}  // namespace

static void with_no_depth_an_impulse_returns_at_exactly_12_ms() {
    ChorusProcessor c;
    c.prepare(kRate, kBlock);
    configure(c, 70.0f, 0.8f, 0.0f);  // 12 ms = 576 samples; 70 % is not the 50 % default

    const auto out = run(c, impulse(2000));

    CHECK_CLOSE(out[0], 1.0, 1e-6);  // the dry signal, untouched
    CHECK_CLOSE(out[576], 0.7, 1e-6);
    for (size_t i = 1; i < out.size(); ++i) {
        if (i != 576) CHECK_CLOSE(out[i], 0.0, 1e-6);
    }
}

static void the_sweep_stays_between_6_and_18_ms() {
    ChorusProcessor c;
    c.prepare(kRate, kBlock);
    configure(c, 100.0f, 2.0f, 100.0f);  // one sweep per 24000 samples, +-288 samples

    const auto d = sweptDelay(c, kRate, 50000);  // two whole sweeps

    const auto [lo, hi] = extent(d, 2000);
    CHECK(lo >= 287.5);  // 6 ms
    CHECK(hi <= 864.5);  // 18 ms
    // ...and it really gets there, rather than sitting near 12 ms.
    CHECK(lo < 289.0);
    CHECK(hi > 863.0);
    CHECK_CLOSE(d[6000], 864.0, 0.5);   // a quarter sweep in: sin = 1
    CHECK_CLOSE(d[12000], 576.0, 0.5);  // half way: sin = 0
    CHECK_CLOSE(d[18000], 288.0, 0.5);  // three quarters: sin = -1
    CHECK_CLOSE(d[30000], 864.0, 0.5);  // and again on the second sweep
}

static void a_level_of_zero_leaves_the_signal_unchanged() {
    ChorusProcessor c;
    c.prepare(kRate, kBlock);
    configure(c, 0.0f, 5.0f, 100.0f);

    std::vector<float> in(5000);
    for (size_t i = 0; i < in.size(); ++i) in[i] = 0.5f * std::sin(static_cast<float>(i) * 0.05f);
    const auto out = run(c, in);

    for (size_t i = 0; i < out.size(); ++i) CHECK_CLOSE(out[i], in[i], 1e-6);
}

static void params_are_clamped_to_their_ranges() {
    {
        // A level far over 100 % adds the copy at full level, not five times over.
        ChorusProcessor c;
        c.prepare(kRate, kBlock);
        configure(c, 500.0f, 0.8f, 0.0f);
        const auto out = run(c, impulse(1000));
        CHECK_CLOSE(out[576], 1.0, 1e-6);
    }
    {
        // A negative level adds nothing.
        ChorusProcessor c;
        c.prepare(kRate, kBlock);
        configure(c, -50.0f, 0.8f, 0.0f);
        const auto out = run(c, impulse(1000));
        CHECK_CLOSE(out[576], 0.0, 1e-6);
    }
    {
        // A depth far over 100 % still stops at 6 and 18 ms; unclamped, 1000 %
        // would ask for 12 +- 60 ms and run off the end of the line.
        ChorusProcessor c;
        c.prepare(kRate, kBlock);
        configure(c, 100.0f, 2.0f, 1000.0f);
        const auto [lo, hi] = extent(sweptDelay(c, kRate, 30000), 2000);
        CHECK(hi <= 864.5);
        CHECK(hi > 863.0);
        CHECK(lo >= 287.5);
    }
    {
        // A negative depth is no sweep at all: the copy stays at 12 ms. Unclamped,
        // -100 % would sweep the other way and put the copy near sample 536.
        ChorusProcessor c;
        c.prepare(kRate, kBlock);
        configure(c, 100.0f, 2.0f, -100.0f);
        const auto out = run(c, impulse(1000));
        CHECK_CLOSE(out[576], 1.0, 1e-6);
    }
    {
        // A rate far over 5 Hz runs at 5 Hz: a quarter sweep is 2400 samples.
        // At 1000 Hz sample 2400 would be exactly 50 cycles in, at 576.
        ChorusProcessor c;
        c.prepare(kRate, kBlock);
        configure(c, 100.0f, 1000.0f, 100.0f);
        const auto d = sweptDelay(c, kRate, 5000);
        CHECK_CLOSE(d[2400], 864.0, 0.5);
    }
    {
        // A rate under 0.05 Hz runs at 0.05 Hz:
        // 576 + 288 x sin(2 pi x 6000 x 0.05 / 48000) = 587.31, where 0.001 Hz gives 576.23.
        ChorusProcessor c;
        c.prepare(kRate, kBlock);
        configure(c, 100.0f, 0.001f, 100.0f);
        const auto d = sweptDelay(c, kRate, 7000);
        CHECK_CLOSE(d[6000], 587.31, 0.5);
    }
}

static void non_finite_params_are_read_as_safe_values() {
    const float nan = std::numeric_limits<float>::quiet_NaN();
    const float inf = std::numeric_limits<float>::infinity();
    {
        // Nothing readable: level 0, so the dry signal alone.
        ChorusProcessor c;
        c.prepare(kRate, kBlock);
        configure(c, nan, inf, -inf);

        std::vector<float> in(5000);
        for (size_t i = 0; i < in.size(); ++i) in[i] = std::sin(static_cast<float>(i) * 0.05f);
        const auto out = run(c, in);
        for (size_t i = 0; i < out.size(); ++i) {
            CHECK_FINITE(out[i]);
            CHECK_CLOSE(out[i], in[i], 1e-6);
        }
    }
    {
        // An unreadable depth is no sweep (not the 100 % a clamp would give):
        // the copy sits at exactly 12 ms.
        ChorusProcessor c;
        c.prepare(kRate, kBlock);
        configure(c, 100.0f, nan, inf);
        const auto out = run(c, impulse(1000));
        for (float v : out) CHECK_FINITE(v);
        CHECK_CLOSE(out[576], 1.0, 1e-6);
    }
    {
        // An unreadable rate is the 0.8 Hz default: a quarter sweep is 15000
        // samples. (At the 0.05 Hz floor it would read 604 here.)
        ChorusProcessor c;
        c.prepare(kRate, kBlock);
        configure(c, 100.0f, nan, 100.0f);
        const auto d = sweptDelay(c, kRate, 16000);
        CHECK_CLOSE(d[15000], 864.0, 0.5);
    }
}

static void a_non_finite_input_sample_cannot_poison_the_line() {
    ChorusProcessor c;
    c.prepare(kRate, kBlock);
    configure(c, 100.0f, 5.0f, 100.0f);

    std::vector<float> in(240000, 0.25f);  // five seconds
    in[10] = std::numeric_limits<float>::quiet_NaN();
    in[20] = std::numeric_limits<float>::infinity();
    in[30] = -std::numeric_limits<float>::infinity();
    const auto out = run(c, in);

    size_t nonFinite = 0;
    for (float v : out) {
        if (!std::isfinite(v)) ++nonFinite;
    }
    CHECK(nonFinite == 0);

    // Once the bad samples are out of reach (at most 18 ms, 864 samples back),
    // dry plus copy is exactly 0.5 again. An infinity let into the line would
    // still be coming out as inf or NaN.
    double worst = 0.0;
    for (size_t i = 2000; i < out.size(); ++i) worst = std::max(worst, std::fabs(out[i] - 0.5));
    CHECK(worst < 1e-5);
}

static void input_below_the_flush_threshold_comes_out_as_exact_zeros() {
    ChorusProcessor c;
    c.prepare(kRate, kBlock);
    configure(c, 100.0f, 0.8f, 50.0f);

    const auto out = run(c, std::vector<float>(5000, 1.0e-30f));

    size_t nonZero = 0;
    for (float v : out) {
        if (v != 0.0f) ++nonZero;
    }
    CHECK(nonZero == 0);
}

static void reset_clears_the_line() {
    ChorusProcessor c;
    c.prepare(kRate, kBlock);
    configure(c, 100.0f, 0.8f, 0.0f);

    run(c, impulse(100));  // the copy is due 576 samples after the impulse
    c.reset();
    const auto out = run(c, std::vector<float>(1000, 0.0f));

    for (float v : out) CHECK_CLOSE(v, 0.0, 1e-9);
}

static void reset_restarts_the_sweep() {
    ChorusProcessor c;
    c.prepare(kRate, kBlock);
    configure(c, 100.0f, 2.0f, 100.0f);
    run(c, std::vector<float>(5000, 0.0f));  // the sweep is now 5000 samples in

    c.reset();
    configure(c, 100.0f, 2.0f, 100.0f);
    const auto d = sweptDelay(c, kRate, 7000);

    // From a phase of zero, a quarter sweep (6000 samples) is the full 18 ms.
    // Carried on from 5000 samples in, it would read 650.5.
    CHECK_CLOSE(d[6000], 864.0, 0.5);
}

static void the_first_params_after_a_reset_take_effect_at_once() {
    ChorusProcessor c;
    c.prepare(kRate, kBlock);
    configure(c, 0.0f, 5.0f, 100.0f);  // stale values, as after a long bypass
    c.reset();
    configure(c, 100.0f, 0.8f, 0.0f);  // what the user actually has set

    const auto out = run(c, impulse(1000));

    // Gliding from the stale level would leave the copy under half height at
    // sample 576, and gliding from the stale depth would move it off 576.
    CHECK_CLOSE(out[576], 1.0, 1e-6);
}

static void changing_the_depth_or_rate_glides_instead_of_jumping() {
    {
        // Depth 0 to 100 % a quarter sweep in, where sin = 1: a hard step would
        // move the delay by 288 samples in one sample.
        ChorusProcessor c;
        c.prepare(kRate, kBlock);
        configure(c, 100.0f, 2.0f, 0.0f);
        const float deeper[3] = {100.0f, 2.0f, 100.0f};
        const auto in = ramp(31000, kRate);
        const auto d = delayOf(in, runWithChange(c, in, 6000, deeper), kRate);

        CHECK(worstStep(d, 2000) < 1.0);
        CHECK_CLOSE(d[30000], 864.0, 1.0);  // and it does arrive at full depth
    }
    {
        // Rate 0.5 to 5 Hz: the sweep speeds up from where it is. A phase worked
        // out from absolute time instead would jump 62 samples here.
        ChorusProcessor c;
        c.prepare(kRate, kBlock);
        configure(c, 100.0f, 0.5f, 100.0f);
        const float faster[3] = {100.0f, 5.0f, 100.0f};
        const auto in = ramp(60000, kRate);
        const auto d = delayOf(in, runWithChange(c, in, 30000, faster), kRate);

        CHECK(worstStep(d, 2000) < 1.0);
    }
}

static void changing_the_level_glides_instead_of_jumping() {
    ChorusProcessor c;
    c.prepare(kRate, kBlock);
    configure(c, 0.0f, 0.8f, 0.0f);
    const float louder[3] = {100.0f, 0.8f, 0.0f};

    // A constant input: once the line has filled the copy is 0.5 too, so a hard
    // level step would jump the output from 0.5 to 1.0 in one sample.
    const auto out = runWithChange(c, std::vector<float>(20000, 0.5f), 10000, louder);

    float worst = 0.0f;
    for (size_t i = 1001; i < out.size(); ++i) worst = std::max(worst, std::fabs(out[i] - out[i - 1]));
    CHECK(worst < 0.01f);
    CHECK_CLOSE(out.back(), 1.0, 1e-3);
}

static void the_line_is_safe_at_44_1_48_and_96_khz() {
    {
        // 44.1 kHz: 12 ms is 529.2 samples, read between two of them.
        ChorusProcessor c;
        c.prepare(44100.0, kBlock);
        configure(c, 100.0f, 0.8f, 0.0f);
        const auto out = run(c, impulse(1000));
        CHECK_CLOSE(out[529], 0.8, 1e-3);
        CHECK_CLOSE(out[530], 0.2, 1e-3);
    }
    {
        // 48 kHz: 288 to 864 samples.
        ChorusProcessor c;
        c.prepare(48000.0, kBlock);
        configure(c, 100.0f, 2.0f, 100.0f);
        const auto d = sweptDelay(c, 48000.0, 20000);
        CHECK_CLOSE(d[6000], 864.0, 0.5);
        CHECK_CLOSE(d[18000], 288.0, 0.5);
    }
    {
        // 96 kHz: 576 to 1728 samples, still well inside the 4096-sample line.
        ChorusProcessor c;
        c.prepare(96000.0, kBlock);
        configure(c, 100.0f, 2.0f, 100.0f);
        const auto d = sweptDelay(c, 96000.0, 40000);
        CHECK_CLOSE(d[12000], 1728.0, 0.5);
        CHECK_CLOSE(d[36000], 576.0, 0.5);
    }
    {
        // 384 kHz: 18 ms would be 6912 samples, more than the line holds. The
        // read is clamped to the longest the line allows instead.
        ChorusProcessor c;
        c.prepare(384000.0, kBlock);
        configure(c, 100.0f, 2.0f, 100.0f);
        const auto in = ramp(20000, 384000.0);
        const auto out = run(c, in);
        size_t nonFinite = 0;
        for (float v : out) {
            if (!std::isfinite(v)) ++nonFinite;
        }
        CHECK(nonFinite == 0);
        const auto [lo, hi] = extent(delayOf(in, out, 384000.0), 5000);
        (void)lo;
        CHECK_CLOSE(hi, static_cast<double>(ChorusProcessor::kLineSize - 2), 0.5);
    }
}

static void run_tests() {
    with_no_depth_an_impulse_returns_at_exactly_12_ms();
    the_sweep_stays_between_6_and_18_ms();
    a_level_of_zero_leaves_the_signal_unchanged();
    params_are_clamped_to_their_ranges();
    non_finite_params_are_read_as_safe_values();
    a_non_finite_input_sample_cannot_poison_the_line();
    input_below_the_flush_threshold_comes_out_as_exact_zeros();
    reset_clears_the_line();
    reset_restarts_the_sweep();
    the_first_params_after_a_reset_take_effect_at_once();
    changing_the_depth_or_rate_glides_instead_of_jumping();
    changing_the_level_glides_instead_of_jumping();
    the_line_is_safe_at_44_1_48_and_96_khz();
}

TEST_MAIN("ChorusProcessor")

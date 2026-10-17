#include "DriveProcessor.h"
#include "test_util.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <limits>
#include <vector>

namespace {

constexpr double kRate = 48000.0;
constexpr int kBlock = 128;
constexpr double kPi = 3.141592653589793;
using Type = DriveProcessor::Type;

void configure(DriveProcessor& d, float levelDb, float gainDb, float tonePercent, float type) {
    const float params[4] = {levelDb, gainDb, tonePercent, type};
    d.setParams(params);
}

void prepared(DriveProcessor& d, double rate, float levelDb, float gainDb, float tonePercent, float type) {
    d.prepare(rate, kBlock);
    configure(d, levelDb, gainDb, tonePercent, type);
}

std::vector<float> sine(size_t length, double hz, double amplitude, double rate) {
    std::vector<float> x(length);
    for (size_t i = 0; i < length; ++i) {
        x[i] = static_cast<float>(amplitude * std::sin(2.0 * kPi * hz * static_cast<double>(i) / rate));
    }
    return x;
}

/** Processes `data` in blocks of kBlock (the last one may be shorter). */
std::vector<float> run(DriveProcessor& d, std::vector<float> data) {
    for (size_t start = 0; start < data.size(); start += static_cast<size_t>(kBlock)) {
        const int n = static_cast<int>(std::min<size_t>(static_cast<size_t>(kBlock), data.size() - start));
        d.process(data.data() + start, n);
    }
    return data;
}

double rms(const std::vector<float>& x, size_t from) {
    double sum = 0.0;
    for (size_t i = from; i < x.size(); ++i) sum += static_cast<double>(x[i]) * x[i];
    return std::sqrt(sum / static_cast<double>(x.size() - from));
}

/** |X(hz)|² of the DFT of x[from .. from + length). */
double dftPower(const std::vector<float>& x, size_t from, size_t length, double hz, double rate) {
    double re = 0.0;
    double im = 0.0;
    for (size_t n = 0; n < length; ++n) {
        const double phase = 2.0 * kPi * hz * static_cast<double>(n) / rate;
        re += x[from + n] * std::cos(phase);
        im -= x[from + n] * std::sin(phase);
    }
    return re * re + im * im;
}

/**
 * Energy that is not at DC or a harmonic of f0: the aliases. By Parseval the
 * whole spectrum holds length × Σx²; the harmonics below Nyquist appear twice
 * (positive and negative frequency), DC once. `length` must be one second so
 * every harmonic of an integer f0 falls exactly on a bin.
 */
double aliasEnergy(const std::vector<float>& y, size_t from, size_t length, double f0, double rate) {
    double total = 0.0;
    for (size_t n = 0; n < length; ++n) total += static_cast<double>(y[from + n]) * y[from + n];
    total *= static_cast<double>(length);
    double harmonic = dftPower(y, from, length, 0.0, rate);
    for (double f = f0; f < rate / 2.0; f += f0) harmonic += 2.0 * dftPower(y, from, length, f, rate);
    return total - harmonic;
}

double maxStep(const std::vector<float>& y, size_t from, size_t to) {
    double m = 0.0;
    for (size_t i = from + 1; i < to; ++i) m = std::max(m, std::fabs(static_cast<double>(y[i]) - y[i - 1]));
    return m;
}

/** `x` run start to finish through a fixed, never-switching type. */
std::vector<float> fixedTypeRun(double rate, float levelDb, float gainDb, float tonePercent, Type type,
                                 const std::vector<float>& x) {
    DriveProcessor d;
    prepared(d, rate, levelDb, gainDb, tonePercent, static_cast<float>(type));
    return run(d, x);
}

/**
 * The click a 0 ms crossfade would make at `at`: two never-switching runs of
 * the same input, one per type, spliced together at that sample. This is not
 * quite what an instant switch inside one processor would produce -- the
 * post-clip filters' history differs a little either side of the splice --
 * but half a second in, both runs are in periodic steady state, so the splice
 * is the click's size to a good approximation, and it is what the crossfade
 * must be much smaller than.
 */
std::vector<float> instantSwitchReference(double rate, float gainDb, Type before, Type after, size_t at,
                                           const std::vector<float>& x) {
    const std::vector<float> asBefore = fixedTypeRun(rate, 0.0f, gainDb, 100.0f, before, x);
    const std::vector<float> asAfter = fixedTypeRun(rate, 0.0f, gainDb, 100.0f, after, x);
    std::vector<float> spliced(x.size());
    for (size_t i = 0; i < at; ++i) spliced[i] = asBefore[i];
    for (size_t i = at; i < x.size(); ++i) spliced[i] = asAfter[i];
    return spliced;
}

}  // namespace

static void the_antiderivatives_match_their_curves() {
    const double xs[] = {-30.0, -3.0, -1.2, -0.5, 0.0, 0.3, 0.9, 1.0, 1.1, 2.0, 30.0};
    for (Type type : {Type::Soft, Type::Hard, Type::Asym}) {
        for (double x : xs) {
            const double h = 1.0e-5;
            const double slope = (DriveProcessor::antiderivative(type, x + h) -
                                  DriveProcessor::antiderivative(type, x - h)) / (2.0 * h);
            CHECK_CLOSE(slope, DriveProcessor::curve(type, x), 1.0e-4);
        }
    }
}

static void each_curve_has_its_shape() {
    CHECK(DriveProcessor::curve(Type::Hard, 100.0) == 1.0);
    CHECK(DriveProcessor::curve(Type::Hard, -100.0) == -1.0);
    CHECK_CLOSE(DriveProcessor::curve(Type::Hard, 0.25), 0.25, 1e-12);
    CHECK_CLOSE(DriveProcessor::curve(Type::Soft, -0.8), -DriveProcessor::curve(Type::Soft, 0.8), 1e-12);
    CHECK_CLOSE(DriveProcessor::curve(Type::Asym, 0.0), 0.0, 1e-12);
    // Asymmetric: the two halves of the wave clip differently.
    CHECK(std::fabs(DriveProcessor::curve(Type::Asym, 3.0) + DriveProcessor::curve(Type::Asym, -3.0)) > 0.1);
}

static void adaa_handles_equal_and_huge_inputs() {
    for (Type type : {Type::Soft, Type::Hard, Type::Asym}) {
        CHECK_CLOSE(DriveProcessor::adaa(type, 0.7, 0.7), DriveProcessor::curve(type, 0.7), 1e-12);
        CHECK_FINITE(DriveProcessor::adaa(type, 1.0e6, 1.0e6 + 1.0e-9));
        CHECK_FINITE(DriveProcessor::adaa(type, -1.0e6, 1.0e6));
        const double expected = DriveProcessor::antiderivative(type, 2.0) - DriveProcessor::antiderivative(type, 1.0);
        CHECK_CLOSE(DriveProcessor::adaa(type, 2.0, 1.0), expected, 1e-12);
    }
}

static void adaa_removes_at_least_10_db_of_aliasing() {
    const size_t second = static_cast<size_t>(kRate);
    const std::vector<float> x = sine(2 * second, 2500.0, 0.1, kRate);
    for (float type : {0.0f, 1.0f, 2.0f}) {
        DriveProcessor withAdaa;
        DriveProcessor plain;
        prepared(withAdaa, kRate, 0.0f, 48.0f, 100.0f, type);
        prepared(plain, kRate, 0.0f, 48.0f, 100.0f, type);
        plain.setAntiAliasingForTest(false);
        const double a = aliasEnergy(run(withAdaa, x), second, second, 2500.0, kRate);
        const double p = aliasEnergy(run(plain, x), second, second, 2500.0, kRate);
        std::printf("type %.0f: alias energy with ADAA %.3e, without %.3e (%.1f dB less)\n", type, a, p,
                    10.0 * std::log10(p / a));
        CHECK(a <= p * 0.1);
    }
}

static void level_matching_keeps_a_moderate_sine_within_4_db() {
    const size_t second = static_cast<size_t>(kRate);
    const std::vector<float> x = sine(second, 1000.0, 0.1, kRate);
    for (float type : {0.0f, 1.0f, 2.0f}) {
        for (float gain : {6.0f, 27.0f, 48.0f}) {
            DriveProcessor d;
            prepared(d, kRate, 0.0f, gain, 100.0f, type);
            const std::vector<float> y = run(d, x);
            const double db = 20.0 * std::log10(rms(y, second / 2) / rms(x, second / 2));
            std::printf("type %.0f gain %.0f dB: %+.2f dB\n", type, gain, db);
            CHECK(std::fabs(db) <= 4.0);
        }
    }
}

static void asym_makes_even_harmonics_and_no_dc() {
    const size_t second = static_cast<size_t>(kRate);
    const std::vector<float> x = sine(2 * second, 1000.0, 0.1, kRate);
    DriveProcessor soft;
    DriveProcessor asym;
    prepared(soft, kRate, 0.0f, 27.0f, 100.0f, 0.0f);
    prepared(asym, kRate, 0.0f, 27.0f, 100.0f, 2.0f);
    const std::vector<float> ys = run(soft, x);
    const std::vector<float> ya = run(asym, x);
    const double soft2 = dftPower(ys, second, second, 2000.0, kRate) / dftPower(ys, second, second, 1000.0, kRate);
    const double asym2 = dftPower(ya, second, second, 2000.0, kRate) / dftPower(ya, second, second, 1000.0, kRate);
    CHECK(soft2 < 1.0e-8);
    CHECK(asym2 > 1.0e-4);
    double mean = 0.0;
    for (size_t i = second; i < 2 * second; ++i) mean += ya[i];
    mean /= static_cast<double>(second);
    CHECK(std::fabs(mean) < 1.0e-3);
}

static void tone_rolls_off_the_top() {
    const size_t second = static_cast<size_t>(kRate);
    const std::vector<float> x = sine(second, 8000.0, 0.01, kRate);
    DriveProcessor dark;
    DriveProcessor bright;
    prepared(dark, kRate, 0.0f, 6.0f, 0.0f, 0.0f);
    prepared(bright, kRate, 0.0f, 6.0f, 100.0f, 0.0f);
    const double ratioDb = 20.0 * std::log10(rms(run(bright, x), second / 2) / rms(run(dark, x), second / 2));
    CHECK(ratioDb >= 20.0);
}

static void level_scales_the_output() {
    const size_t second = static_cast<size_t>(kRate);
    const std::vector<float> x = sine(second, 1000.0, 0.1, kRate);
    DriveProcessor unity;
    DriveProcessor boosted;
    prepared(unity, kRate, 0.0f, 27.0f, 100.0f, 0.0f);
    prepared(boosted, kRate, 6.0f, 27.0f, 100.0f, 0.0f);
    const double ratio = rms(run(boosted, x), second / 2) / rms(run(unity, x), second / 2);
    CHECK_CLOSE(ratio, std::pow(10.0, 6.0 / 20.0), 0.01 * 1.995);
}

// second/2 lands exactly on an ascending zero crossing of the 1 kHz test tone
// (cycle 500) -- a bad place to switch, since f(0) = 0 for every curve, so an
// instant switch there is invisible. +4 samples is 30 degrees further round.
// 48 dB is also a bad choice of gain: at 48 dB every type saturates to the
// same level-matched value for most of the cycle, so a switch is invisible
// there too. 27 dB is moderate enough that SOFT, HARD and ASYM disagree
// visibly at this phase.
constexpr size_t kSwitchOffset = 4;
constexpr float kSwitchGainDb = 27.0f;

static void a_type_switch_crossfades_without_a_step() {
    const size_t second = static_cast<size_t>(kRate);
    const std::vector<float> x = sine(second, 1000.0, 0.1, kRate);
    const size_t at = second / 2 + kSwitchOffset;

    const std::vector<float> instant =
        instantSwitchReference(kRate, kSwitchGainDb, Type::Soft, Type::Hard, at, x);
    const double instantStep = maxStep(instant, at - 1, at + 8);
    // The reference itself must contain a real click, or this test would pass
    // trivially no matter how the crossfade behaved.
    CHECK(instantStep > 0.01);

    DriveProcessor d;
    prepared(d, kRate, 0.0f, kSwitchGainDb, 100.0f, 0.0f);
    std::vector<float> y = x;
    d.process(y.data(), static_cast<int32_t>(at));
    configure(d, 0.0f, kSwitchGainDb, 100.0f, 1.0f);
    CHECK(d.crossfading());
    d.process(y.data() + at, 481);
    CHECK(!d.crossfading());
    d.process(y.data() + at + 481, static_cast<int32_t>(second - at - 481));
    const double faded = maxStep(y, at - 1, at + 8);
    std::printf("type switch: instant-switch click %.6f, crossfaded step %.6f\n", instantStep, faded);
    // The crossfade must cut what would otherwise be a click to well under
    // half its instant size.
    CHECK(faded <= 0.5 * instantStep);
}

static void a_second_switch_mid_fade_stays_smooth() {
    const size_t second = static_cast<size_t>(kRate);
    const std::vector<float> x = sine(second, 1000.0, 0.1, kRate);
    const size_t at = second / 2 + kSwitchOffset;
    const size_t at2 = at + 200;

    // The second switch's instant-click reference: HARD up to at2, ASYM after.
    const std::vector<float> instant = instantSwitchReference(kRate, kSwitchGainDb, Type::Hard, Type::Asym, at2, x);
    const double instantStep = maxStep(instant, at2 - 1, at2 + 8);
    CHECK(instantStep > 0.01);

    DriveProcessor d;
    prepared(d, kRate, 0.0f, kSwitchGainDb, 100.0f, 0.0f);
    std::vector<float> y = x;
    d.process(y.data(), static_cast<int32_t>(at));
    configure(d, 0.0f, kSwitchGainDb, 100.0f, 1.0f);
    d.process(y.data() + at, 200);
    configure(d, 0.0f, kSwitchGainDb, 100.0f, 2.0f);
    d.process(y.data() + at + 200, static_cast<int32_t>(second - at2));
    for (size_t i = at; i < second; ++i) CHECK_FINITE(y[i]);
    const double faded = maxStep(y, at2 - 1, at2 + 8);
    std::printf("second switch mid-fade: instant-switch click %.6f, crossfaded step %.6f\n", instantStep, faded);
    CHECK(faded <= 0.5 * instantStep);
    CHECK(d.type() == Type::Asym);
}

static void params_clamp_and_non_finite_reads_as_default() {
    const std::vector<float> x = sine(9600, 440.0, 0.2, kRate);
    const float nan = std::numeric_limits<float>::quiet_NaN();
    const float inf = std::numeric_limits<float>::infinity();

    DriveProcessor defaults;
    DriveProcessor hostile;
    prepared(defaults, kRate, 0.0f, 27.0f, 50.0f, 0.0f);
    prepared(hostile, kRate, nan, inf, -inf, nan);
    const std::vector<float> a = run(defaults, x);
    const std::vector<float> b = run(hostile, x);
    for (size_t i = 0; i < x.size(); ++i) CHECK(a[i] == b[i]);

    DriveProcessor maxed;
    DriveProcessor absurd;
    prepared(maxed, kRate, 24.0f, 48.0f, 100.0f, 1.0f);
    prepared(absurd, kRate, 1.0e9f, 1.0e9f, 1.0e9f, 1.0f);
    const std::vector<float> c = run(maxed, x);
    const std::vector<float> e = run(absurd, x);
    for (size_t i = 0; i < x.size(); ++i) CHECK(c[i] == e[i]);

    DriveProcessor t;
    prepared(t, kRate, 0.0f, 27.0f, 50.0f, 7.0f);
    CHECK(t.type() == Type::Asym);
    configure(t, 0.0f, 27.0f, 50.0f, -3.0f);
    CHECK(t.type() == Type::Soft);
    configure(t, 0.0f, 27.0f, 50.0f, 1.6f);
    CHECK(t.type() == Type::Asym);
    configure(t, 0.0f, 27.0f, 50.0f, 1.2f);
    CHECK(t.type() == Type::Hard);
}

static void a_non_finite_input_sample_is_silence() {
    std::vector<float> clean = sine(9600, 440.0, 0.2, kRate);
    std::vector<float> dirty = clean;
    clean[1000] = 0.0f;
    clean[2000] = 0.0f;
    clean[3000] = 0.0f;
    dirty[1000] = std::numeric_limits<float>::quiet_NaN();
    dirty[2000] = std::numeric_limits<float>::infinity();
    dirty[3000] = -std::numeric_limits<float>::infinity();
    DriveProcessor a;
    DriveProcessor b;
    prepared(a, kRate, 0.0f, 48.0f, 50.0f, 2.0f);
    prepared(b, kRate, 0.0f, 48.0f, 50.0f, 2.0f);
    const std::vector<float> ya = run(a, clean);
    const std::vector<float> yb = run(b, dirty);
    for (size_t i = 0; i < ya.size(); ++i) {
        CHECK_FINITE(yb[i]);
        CHECK(ya[i] == yb[i]);
    }
}

static void hot_input_stays_bounded() {
    for (double rate : {44100.0, 48000.0, 96000.0}) {
        for (float type : {0.0f, 1.0f, 2.0f}) {
            DriveProcessor d;
            prepared(d, rate, 24.0f, 48.0f, 100.0f, type);
            // A deterministic full-scale noise, as from a clipping interface.
            std::vector<float> x(static_cast<size_t>(rate));
            uint32_t seed = 12345u;
            for (float& v : x) {
                seed = seed * 1664525u + 1013904223u;
                v = static_cast<float>(seed >> 8) / static_cast<float>(1u << 24) * 2.0f - 1.0f;
            }
            const std::vector<float> y = run(d, x);
            for (float v : y) {
                CHECK_FINITE(v);
                CHECK(std::fabs(v) < 100.0f);
            }
        }
    }
}

static void silence_after_signal_reaches_exact_zero() {
    DriveProcessor d;
    prepared(d, kRate, 0.0f, 48.0f, 50.0f, 2.0f);
    run(d, sine(24000, 440.0, 0.5, kRate));
    const std::vector<float> tail = run(d, std::vector<float>(static_cast<size_t>(5 * kRate), 0.0f));
    for (size_t i = tail.size() - 1000; i < tail.size(); ++i) CHECK(tail[i] == 0.0f);
}

static void reset_clears_state_and_the_next_params_snap() {
    const std::vector<float> loud = sine(24000, 220.0, 0.8, kRate);
    const std::vector<float> probe = sine(4800, 1000.0, 0.1, kRate);

    DriveProcessor used;
    prepared(used, kRate, -6.0f, 40.0f, 20.0f, 1.0f);
    run(used, loud);
    used.reset();
    configure(used, 12.0f, 27.0f, 50.0f, 0.0f);

    DriveProcessor fresh;
    prepared(fresh, kRate, 12.0f, 27.0f, 50.0f, 0.0f);

    const std::vector<float> a = run(used, probe);
    const std::vector<float> b = run(fresh, probe);
    for (size_t i = 0; i < a.size(); ++i) CHECK(a[i] == b[i]);
}

static void run_tests() {
    the_antiderivatives_match_their_curves();
    each_curve_has_its_shape();
    adaa_handles_equal_and_huge_inputs();
    adaa_removes_at_least_10_db_of_aliasing();
    level_matching_keeps_a_moderate_sine_within_4_db();
    asym_makes_even_harmonics_and_no_dc();
    tone_rolls_off_the_top();
    level_scales_the_output();
    a_type_switch_crossfades_without_a_step();
    a_second_switch_mid_fade_stays_smooth();
    params_clamp_and_non_finite_reads_as_default();
    a_non_finite_input_sample_is_silence();
    hot_input_stays_bounded();
    silence_after_signal_reaches_exact_zero();
    reset_clears_state_and_the_next_params_snap();
}

TEST_MAIN("DriveProcessor")

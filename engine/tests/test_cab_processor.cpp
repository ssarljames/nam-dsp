#include "CabProcessor.h"
#include "test_util.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>

namespace {

constexpr double kRate = 48000.0;
constexpr int kBlock = 128;

/** Deterministic pseudo-random values in [-1, 1). */
struct Lcg {
    uint32_t state;
    explicit Lcg(uint32_t seed) : state(seed) {}
    float next() {
        state = state * 1664525u + 1013904223u;
        return static_cast<float>(state >> 8) / 8388608.0f - 1.0f;
    }
};

std::vector<float> noise(size_t n, uint32_t seed) {
    Lcg rng(seed);
    std::vector<float> out(n);
    for (auto& v : out) v = rng.next();
    return out;
}

void setLevel(CabProcessor& cab, float db) {
    const float params[1] = {db};
    cab.setParams(params);
}

void prepared(CabProcessor& cab) {
    cab.prepare(kRate, kBlock);
    setLevel(cab, 0.0f);
}

void loadIr(CabProcessor& cab, const std::vector<float>& ir) {
    for (size_t i = 0; i < ir.size(); ++i) cab.staging()[i] = ir[i];
    CHECK(cab.loadIr(static_cast<int32_t>(ir.size())));
}

/** Processes `in` in blocks of `block` (the last one may be shorter). */
std::vector<float> run(CabProcessor& cab, const std::vector<float>& in, int block = kBlock) {
    std::vector<float> out = in;
    for (size_t start = 0; start < out.size(); start += static_cast<size_t>(block)) {
        const int n = static_cast<int>(std::min<size_t>(static_cast<size_t>(block), out.size() - start));
        cab.process(out.data() + start, n);
    }
    return out;
}

/** The definition of convolution, in double, with no ring buffer. */
std::vector<float> naive(const std::vector<float>& ir, const std::vector<float>& in) {
    std::vector<float> out(in.size());
    for (size_t n = 0; n < in.size(); ++n) {
        double acc = 0.0;
        for (size_t k = 0; k < ir.size() && k <= n; ++k) acc += static_cast<double>(ir[k]) * in[n - k];
        out[n] = static_cast<float>(acc);
    }
    return out;
}

double maxAbsDiff(const std::vector<float>& a, const std::vector<float>& b) {
    double worst = 0.0;
    for (size_t i = 0; i < a.size(); ++i) worst = std::max(worst, static_cast<double>(std::fabs(a[i] - b[i])));
    return worst;
}

}  // namespace

static void with_no_ir_the_stage_is_a_passthrough() {
    CabProcessor cab;
    prepared(cab);
    CHECK(cab.length() == 0);

    const std::vector<float> in = noise(500, 1);
    CHECK_CLOSE(maxAbsDiff(run(cab, in), in), 0.0, 0.0);
}

static void a_unit_impulse_ir_is_the_identity() {
    CabProcessor cab;
    prepared(cab);
    loadIr(cab, {1.0f});

    const std::vector<float> in = noise(1000, 2);
    CHECK_CLOSE(maxAbsDiff(run(cab, in), in), 0.0, 1e-6);
}

static void a_delayed_scaled_impulse_delays_and_scales() {
    CabProcessor cab;
    prepared(cab);
    std::vector<float> ir(10, 0.0f);
    ir[3] = 0.5f;
    loadIr(cab, ir);

    std::vector<float> in(20, 0.0f);
    in[0] = 1.0f;
    const std::vector<float> out = run(cab, in);
    for (size_t i = 0; i < out.size(); ++i) CHECK_CLOSE(out[i], i == 3 ? 0.5 : 0.0, 1e-6);
}

static void a_multi_tap_ir_returns_each_tap_in_order() {
    CabProcessor cab;
    prepared(cab);
    loadIr(cab, {0.25f, 0.0f, -0.5f});

    std::vector<float> in(8, 0.0f);
    in[0] = 1.0f;
    const std::vector<float> out = run(cab, in);
    CHECK_CLOSE(out[0], 0.25, 1e-6);
    CHECK_CLOSE(out[1], 0.0, 1e-6);
    CHECK_CLOSE(out[2], -0.5, 1e-6);
    CHECK_CLOSE(out[3], 0.0, 1e-6);
}

static void a_short_ir_matches_the_definition_across_the_history_wrap() {
    CabProcessor cab;
    prepared(cab);
    std::vector<float> ir = noise(100, 3);
    for (auto& t : ir) t *= 0.1f;
    loadIr(cab, ir);

    // Longer than the history ring, so the write position wraps more than once.
    const std::vector<float> in = noise(3 * CabProcessor::kMaxTaps + 77, 4);
    CHECK_CLOSE(maxAbsDiff(run(cab, in), naive(ir, in)), 0.0, 1e-4);
}

static void a_full_length_ir_matches_the_definition() {
    CabProcessor cab;
    prepared(cab);
    std::vector<float> ir = noise(CabProcessor::kMaxTaps, 5);
    for (auto& t : ir) t *= (1.0f / 64.0f);
    loadIr(cab, ir);

    const std::vector<float> in = noise(6000, 6);
    CHECK_CLOSE(maxAbsDiff(run(cab, in), naive(ir, in)), 0.0, 1e-4);
}

static void an_ir_length_that_is_not_a_multiple_of_four_is_exact() {
    CabProcessor cab;
    prepared(cab);
    for (int32_t length : {1, 2, 3, 5, 6, 7, 129, 1001}) {
        std::vector<float> ir = noise(static_cast<size_t>(length), 8);
        loadIr(cab, ir);
        cab.reset();
        const std::vector<float> in = noise(2500, 9);
        CHECK_CLOSE(maxAbsDiff(run(cab, in), naive(ir, in)), 0.0, 1e-4);
    }
}

static void the_output_does_not_depend_on_the_block_size() {
    std::vector<float> ir = noise(300, 10);
    const std::vector<float> in = noise(2000, 11);

    CabProcessor a;
    prepared(a);
    loadIr(a, ir);
    CabProcessor b;
    prepared(b);
    loadIr(b, ir);

    CHECK_CLOSE(maxAbsDiff(run(a, in, kBlock), run(b, in, 37)), 0.0, 0.0);
}

static void a_shorter_ir_is_not_affected_by_a_longer_one_loaded_before() {
    CabProcessor cab;
    prepared(cab);
    loadIr(cab, std::vector<float>(CabProcessor::kMaxTaps, 0.01f));

    // Length 3 pads to 4 taps in the dot product, so a stale tap at index 3
    // would leak straight into the output.
    loadIr(cab, {1.0f, 0.0f, 0.0f});
    cab.reset();
    const std::vector<float> in = noise(500, 12);
    CHECK_CLOSE(maxAbsDiff(run(cab, in), in), 0.0, 1e-6);
}

static void loading_zero_taps_unloads_the_ir() {
    CabProcessor cab;
    prepared(cab);
    loadIr(cab, {0.0f, 0.5f});
    CHECK(cab.length() == 2);

    CHECK(cab.loadIr(0));
    CHECK(cab.length() == 0);
    const std::vector<float> in = noise(200, 13);
    CHECK_CLOSE(maxAbsDiff(run(cab, in), in), 0.0, 0.0);
}

static void a_bad_load_is_rejected_and_leaves_the_current_ir_alone() {
    CabProcessor cab;
    prepared(cab);
    loadIr(cab, {1.0f, 0.5f});

    CHECK(!cab.loadIr(CabProcessor::kMaxTaps + 1));
    CHECK(!cab.loadIr(-1));
    cab.staging()[0] = std::nanf("");
    CHECK(!cab.loadIr(1));
    cab.staging()[0] = INFINITY;
    CHECK(!cab.loadIr(1));

    CHECK(cab.length() == 2);
    std::vector<float> in(4, 0.0f);
    in[0] = 1.0f;
    const std::vector<float> out = run(cab, in);
    CHECK_CLOSE(out[0], 1.0, 1e-6);
    CHECK_CLOSE(out[1], 0.5, 1e-6);
}

static void reset_clears_the_tail_but_keeps_the_ir() {
    CabProcessor cab;
    prepared(cab);
    loadIr(cab, {0.0f, 0.0f, 0.0f, 1.0f});  // a delay of three samples

    std::vector<float> first = {0.0f, 1.0f};  // impulse at n = 1
    cab.process(first.data(), 2);
    cab.reset();

    // Without the reset the impulse would emerge at n = 4, i.e. index 2 here.
    std::vector<float> after(6, 0.0f);
    cab.process(after.data(), 6);
    for (float v : after) CHECK_CLOSE(v, 0.0, 1e-6);

    // The IR itself survived: a fresh impulse still comes out three samples later.
    std::vector<float> again(6, 0.0f);
    again[0] = 1.0f;
    cab.process(again.data(), 6);
    CHECK_CLOSE(again[3], 1.0, 1e-6);
}

static void an_ir_loaded_later_convolves_against_recent_input() {
    CabProcessor cab;
    prepared(cab);

    // No IR yet: the history is still being written.
    std::vector<float> before(4, 0.0f);
    before[3] = 1.0f;
    cab.process(before.data(), 4);

    loadIr(cab, {0.0f, 0.5f});  // a delay of one sample
    std::vector<float> next(2, 0.0f);
    cab.process(next.data(), 2);
    CHECK_CLOSE(next[0], 0.5, 1e-6);  // the impulse at n = 3 emerges at n = 4
}

static void the_level_param_scales_the_output_and_is_smoothed() {
    CabProcessor cab;
    prepared(cab);
    loadIr(cab, {1.0f});
    setLevel(cab, 6.0f);

    const std::vector<float> out = run(cab, std::vector<float>(20000, 0.25f));
    CHECK(out[0] < 0.25f * 1.9f);  // a glide, not a step
    CHECK_CLOSE(out.back(), 0.25 * 1.995262, 1e-3);
}

static void denormal_and_nan_input_are_flushed_out_of_the_history() {
    CabProcessor cab;
    prepared(cab);
    loadIr(cab, {1.0f});

    std::vector<float> in(64, 1.0e-30f);
    in.insert(in.end(), 64, std::nanf(""));
    const std::vector<float> out = run(cab, in);
    for (float v : out) CHECK(v == 0.0f);
}

static void output_stays_finite_at_the_extremes() {
    for (float db : {-24.0f, 24.0f}) {
        CabProcessor cab;
        prepared(cab);
        std::vector<float> ir(CabProcessor::kMaxTaps);
        for (size_t i = 0; i < ir.size(); ++i) ir[i] = (i % 2 == 0) ? 1.0f : -1.0f;
        loadIr(cab, ir);
        setLevel(cab, db);

        const std::vector<float> out = run(cab, std::vector<float>(5000, 1.0f));
        for (float v : out) CHECK_FINITE(v);
    }
}

static void a_full_length_ir_runs_well_inside_real_time() {
    CabProcessor cab;
    prepared(cab);
    std::vector<float> ir = noise(CabProcessor::kMaxTaps, 14);
    for (auto& t : ir) t *= (1.0f / 64.0f);
    loadIr(cab, ir);

    const std::vector<float> in = noise(static_cast<size_t>(kRate), 15);
    const auto start = std::chrono::steady_clock::now();
    const std::vector<float> out = run(cab, in);
    const double seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();

    std::printf("cab: 1 s of audio through %d taps took %.1f ms (%.1f%% of real time)\n",
                CabProcessor::kMaxTaps, seconds * 1000.0, seconds * 100.0);
    CHECK_FINITE(out.back());
    CHECK(seconds < 0.5);
}

static void run_tests() {
    with_no_ir_the_stage_is_a_passthrough();
    a_unit_impulse_ir_is_the_identity();
    a_delayed_scaled_impulse_delays_and_scales();
    a_multi_tap_ir_returns_each_tap_in_order();
    a_short_ir_matches_the_definition_across_the_history_wrap();
    a_full_length_ir_matches_the_definition();
    an_ir_length_that_is_not_a_multiple_of_four_is_exact();
    the_output_does_not_depend_on_the_block_size();
    a_shorter_ir_is_not_affected_by_a_longer_one_loaded_before();
    loading_zero_taps_unloads_the_ir();
    a_bad_load_is_rejected_and_leaves_the_current_ir_alone();
    reset_clears_the_tail_but_keeps_the_ir();
    an_ir_loaded_later_convolves_against_recent_input();
    the_level_param_scales_the_output_and_is_smoothed();
    denormal_and_nan_input_are_flushed_out_of_the_history();
    output_stays_finite_at_the_extremes();
    a_full_length_ir_runs_well_inside_real_time();
}

TEST_MAIN("CabProcessor")

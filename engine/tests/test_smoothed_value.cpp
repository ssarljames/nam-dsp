#include "SmoothedValue.h"
#include "test_util.h"

static void converges_monotonically_without_overshoot() {
    SmoothedValue s;
    s.prepare(48000.0, 20.0);
    s.snapTo(0.0f);
    s.setTarget(1.0f);

    float previous = s.current();
    for (int i = 0; i < 48000; ++i) {
        const float v = s.next();
        CHECK_FINITE(v);
        CHECK(v >= previous);   // monotonic
        CHECK(v <= 1.0f);       // never overshoots
        previous = v;
    }
}

static void reaches_the_target_exactly_within_400ms() {
    SmoothedValue s;
    s.prepare(48000.0, 20.0);
    s.snapTo(0.0f);
    s.setTarget(1.0f);

    const int samples = static_cast<int>(48000 * 0.4);
    for (int i = 0; i < samples; ++i) s.next();

    // Exactly, not approximately. Measured convergence for this case is
    // ~207 ms (the float32 stall guard fires); 400 ms is margin.
    CHECK(s.current() == s.target());
}

// Regression test for the float32 stall. A +24 dB gain target stalls ~5e-4
// short of its destination, which is four orders of magnitude above kEpsilon:
// with only the absolute-epsilon guard this never terminates at all.
static void reaches_a_large_target_exactly_too() {
    SmoothedValue s;
    s.prepare(48000.0, 20.0);
    s.snapTo(0.0f);
    s.setTarget(15.848932f);  // +24 dB as a linear gain

    const int samples = static_cast<int>(48000 * 0.4);
    for (int i = 0; i < samples; ++i) s.next();

    CHECK(s.current() == s.target());
}

// The approach to zero is the case the absolute epsilon is actually for:
// there is no ULP stall, the difference just decays until it would go
// denormal. It needs ~322 ms, longer than the stall-guarded cases.
static void reaches_zero_exactly() {
    SmoothedValue s;
    s.prepare(48000.0, 20.0);
    s.snapTo(1.0f);
    s.setTarget(0.0f);

    const int samples = static_cast<int>(48000 * 0.5);
    for (int i = 0; i < samples; ++i) s.next();

    CHECK(s.current() == 0.0f);
}

static void one_time_constant_covers_about_63_percent() {
    SmoothedValue s;
    s.prepare(48000.0, 20.0);
    s.snapTo(0.0f);
    s.setTarget(1.0f);

    const int samples = static_cast<int>(48000 * 0.020);
    for (int i = 0; i < samples; ++i) s.next();

    CHECK_CLOSE(s.current(), 0.632, 0.01);
}

static void a_longer_time_constant_converges_more_slowly() {
    SmoothedValue fast, slow;
    fast.prepare(48000.0, 5.0);
    slow.prepare(48000.0, 100.0);
    fast.snapTo(0.0f);
    slow.snapTo(0.0f);
    fast.setTarget(1.0f);
    slow.setTarget(1.0f);

    for (int i = 0; i < 480; ++i) {
        fast.next();
        slow.next();
    }
    CHECK(fast.current() > slow.current());
}

static void snap_to_moves_immediately() {
    SmoothedValue s;
    s.prepare(48000.0, 20.0);
    s.snapTo(0.25f);
    CHECK(s.current() == 0.25f);
    CHECK(s.target() == 0.25f);
    CHECK(s.next() == 0.25f);
}

static void descending_targets_work_too() {
    SmoothedValue s;
    s.prepare(48000.0, 20.0);
    s.snapTo(1.0f);
    s.setTarget(0.0f);

    float previous = s.current();
    for (int i = 0; i < 4800; ++i) {
        const float v = s.next();
        CHECK(v <= previous);
        CHECK(v >= 0.0f);
        previous = v;
    }
}

static void run_tests() {
    converges_monotonically_without_overshoot();
    reaches_the_target_exactly_within_400ms();
    reaches_a_large_target_exactly_too();
    reaches_zero_exactly();
    one_time_constant_covers_about_63_percent();
    a_longer_time_constant_converges_more_slowly();
    snap_to_moves_immediately();
    descending_targets_work_too();
}

TEST_MAIN("SmoothedValue")

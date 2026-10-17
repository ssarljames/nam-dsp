#pragma once

#include <cmath>

/**
 * One-pole smoother. Every parameter target passes through one of these so a
 * k-rate step (one value per 2.67 ms quantum) does not arrive at the DSP as an
 * audible discontinuity.
 *
 * `prepare` takes the rate at which `next()` will be called: the sample rate
 * for per-sample smoothing (gain), or sampleRate / blockSize for per-block
 * smoothing (filter coefficients).
 *
 * RT-safe: no allocation, no branching on anything but the epsilon snap.
 */
class SmoothedValue {
public:
    void prepare(double rateHz, double timeConstantMs = 20.0) {
        const double tc = timeConstantMs * 0.001;
        coeff_ = (tc > 0.0 && rateHz > 0.0) ? (1.0 - std::exp(-1.0 / (tc * rateHz))) : 1.0;
    }

    /** Jump without smoothing. Used at prepare() and reset(). */
    void snapTo(float value) {
        target_ = value;
        current_ = value;
    }

    void setTarget(float value) { target_ = value; }

    float target() const { return target_; }
    float current() const { return current_; }

    inline float next() {
        const float delta = target_ - current_;

        // Guard 1 — the absolute epsilon. Approaching zero, the difference
        // would otherwise decay forever into denormal range, which is a CPU
        // trap in an audio callback.
        if (std::fabs(delta) < kEpsilon) {
            current_ = target_;
            return current_;
        }

        const float stepped = current_ + static_cast<float>(coeff_) * delta;

        // Guard 2 — the float32 stall. Approaching any non-zero target the
        // increment eventually falls below half an ULP of current_ and rounds
        // away, so current_ stops moving while delta is still ~3e-5 (and ~5e-4
        // near a +24 dB gain). Guard 1 can never fire from there: the value
        // would sit short of its target forever. When the step stops making
        // progress, the move is over — finish it.
        if (stepped == current_) {
            current_ = target_;
            return current_;
        }

        current_ = stepped;
        return current_;
    }

private:
    static constexpr float kEpsilon = 1.0e-7f;

    double coeff_ = 1.0;
    float target_ = 0.0f;
    float current_ = 0.0f;
};

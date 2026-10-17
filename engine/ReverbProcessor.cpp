#include "ReverbProcessor.h"

#include <algorithm>
#include <cmath>

/**
 * How one type voices the shared core (spec 2026-10-01-reverb-effect §3.7).
 * `hfLo`/`hfHi` are the ratio of the high-frequency decay time to DECAY's
 * low-frequency one at TONE 0 and 100; `bandLo`/`bandHi` the input bandwidth.
 */
struct ReverbProcessor::Voice {
    double size;       // scales the tank's line lengths
    float diffusion;   // the input all-passes' coefficient; 0 is none
    double rtLo;       // RT60 at DECAY 0, seconds
    double rtHi;       // RT60 at DECAY 100
    double bandLo;     // input bandwidth at TONE 0, Hz
    double bandHi;     // ...and at TONE 100
    double hfLo;       // high/low decay-time ratio at TONE 0
    double hfHi;       // ...and at TONE 100
    double modMs;      // modulation depth, or the most the MOD knob reaches
    bool modKnob;      // the fifth knob is MOD
    double modHz;      // modulation rate
    double lowCutHz;   // the wet signal's high-pass
    float outGain;     // so the default settings come out near the input level
};

namespace {

using Type = ReverbProcessor::Type;

constexpr double kTwoPi = 6.283185307179586;

// ROOM, HALL, PLATE, SPRING, SHIMMER, AMBIENT, in Type order. The output gains
// were measured: white noise at the default settings comes out at about the
// input's level (pinned by a host test, ±4 dB).
constexpr ReverbProcessor::Voice kVoices[ReverbProcessor::kTypeCount] = {
    {0.35, 0.60f, 0.2, 2.5, 3000.0, 16000.0, 0.15, 0.70, 0.05, false, 0.9, 80.0, 2.60f},
    {1.50, 0.70f, 0.8, 10.0, 2500.0, 14000.0, 0.10, 0.60, 0.8, true, 0.5, 60.0, 4.25f},
    {0.60, 0.78f, 0.5, 8.0, 4000.0, 18000.0, 0.20, 0.85, 0.4, true, 1.0, 100.0, 2.75f},
    {0.45, 0.00f, 0.4, 5.0, 2000.0, 6000.0, 0.10, 0.40, 0.0, false, 0.0, 150.0, 1.85f},
    {1.40, 0.70f, 1.5, 20.0, 3000.0, 14000.0, 0.15, 0.60, 0.4, false, 0.4, 120.0, 6.50f},
    {2.00, 0.75f, 3.0, 30.0, 1500.0, 9000.0, 0.08, 0.45, 1.2, false, 0.3, 80.0, 4.00f},
};

// The tank's base line lengths, scaled by the type's size. No two share a
// small common factor, so their echoes do not pile up on the same samples.
constexpr double kLineMs[ReverbProcessor::kLineCount] = {31.1, 37.3, 41.9, 47.1, 53.9, 61.3, 69.7, 79.1};
// Each line's LFO rate against the type's, so no two lines sweep together.
constexpr float kLfoRatio[ReverbProcessor::kLineCount] = {1.0f, 1.13f, 0.87f, 1.27f, 0.79f, 1.41f, 0.71f, 1.19f};
// The signs the input enters and the output leaves each line with.
constexpr float kInSign[ReverbProcessor::kLineCount] = {1, 1, -1, -1, 1, -1, 1, -1};
constexpr float kOutSign[ReverbProcessor::kLineCount] = {1, -1, 1, -1, -1, 1, -1, 1};
constexpr float kInjectGain = 0.35355339f;  // 1 / sqrt(8)
constexpr float kTankOutGain = 0.35355339f;

constexpr double kDiffuserMs[ReverbProcessor::kDiffuserCount] = {4.771, 3.595, 12.735, 9.307};
constexpr double kBloomMs[ReverbProcessor::kBloomCount] = {61.3, 89.9, 117.1, 143.7};
constexpr double kSpringMs[ReverbProcessor::kSpringCount] = {33.7, 41.3};
// The spring's dispersion sits below fs / (2 K): about 4.8 kHz.
constexpr double kDispersionHz = 9600.0;
constexpr double kShifterMs = 50.0;
// How much of the spring's diffuse body sits under its boing.
constexpr float kSpringBody = 0.5f;

constexpr double kEarlyMs[ReverbProcessor::kEarlyTapCount] = {4.3, 7.9, 11.2, 15.8, 19.3, 23.7, 28.9, 33.1};
// Falling, alternating, and scaled by 1 / sqrt(sum of squares) so EARLY 100 %
// gives reflections about as loud as the input.
constexpr float kEarlyNorm = 0.6623f;
constexpr float kEarlyGain[ReverbProcessor::kEarlyTapCount] = {
    0.84f * kEarlyNorm, -0.70f * kEarlyNorm, 0.60f * kEarlyNorm, -0.51f * kEarlyNorm,
    0.43f * kEarlyNorm, -0.36f * kEarlyNorm, 0.30f * kEarlyNorm, -0.25f * kEarlyNorm};

float finiteOr(float v, float fallback) { return std::isfinite(v) ? v : fallback; }

float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

/** Anything too small to matter becomes an exact zero, so a tail cannot sink into denormals. */
inline float flush(float v) { return std::fabs(v) < ReverbProcessor::kFlush ? 0.0f : v; }

/** sin(pi x) for x in [-1, 1], to within about 6 %: plenty for a modulation LFO. */
inline float sinPi(float x) { return 4.0f * x * (1.0f - std::fabs(x)); }

/** `delay` samples behind `write` in a power-of-two line, linearly interpolated. */
inline float readAt(const float* line, int32_t mask, int32_t write, float delay) {
    const int32_t whole = static_cast<int32_t>(delay);
    const float fraction = delay - static_cast<float>(whole);
    const float nearer = line[(write - whole) & mask];
    const float further = line[(write - whole - 1) & mask];
    return nearer + (further - nearer) * fraction;
}

/** A Schroeder all-pass, (-g + z^-D) / (1 - g z^-D), on a power-of-two line. */
inline float allpass(float* line, int32_t mask, int32_t write, int32_t length, float g, float x) {
    const float delayed = line[(write - length) & mask];
    const float v = flush(x + g * delayed);
    line[write] = v;
    return delayed - g * v;
}

/** A normalised 8-point Walsh-Hadamard transform: orthogonal, so it moves energy and never adds any. */
inline void hadamard8(float* v) {
    for (int h = 1; h < 8; h <<= 1) {
        for (int i = 0; i < 8; i += h << 1) {
            for (int j = i; j < i + h; ++j) {
                const float a = v[j];
                const float b = v[j + h];
                v[j] = a + b;
                v[j + h] = a - b;
            }
        }
    }
    for (int i = 0; i < 8; ++i) v[i] *= 0.35355339f;
}

/** One-pole coefficient for a cutoff: y = (1 - a) x + a y1. */
float onePoleA(double hz, double rate) { return static_cast<float>(std::exp(-kTwoPi * hz / rate)); }

/**
 * A line's absorption (Jot): the decay gain at DC for `rt` seconds, and the
 * one-pole whose Nyquist gain makes the highs decay in `hf` x `rt`, both for
 * a line `length` samples long. Applying both per pass gives every line the
 * same decay, whatever its length.
 */
void absorption(double length, double rate, double rt, double hf, float& gain, float& a) {
    const double perSecond = -3.0 * length / rate;  // log10 gain per second of RT60
    gain = static_cast<float>(std::pow(10.0, perSecond / rt));
    const double ratio = std::pow(10.0, perSecond * (1.0 / (hf * rt) - 1.0 / rt));
    a = static_cast<float>((1.0 - ratio) / (1.0 + ratio));
}

}  // namespace

const ReverbProcessor::Voice& ReverbProcessor::voiceOf(Type type) {
    return kVoices[static_cast<int32_t>(type)];
}

double ReverbProcessor::decaySeconds(Type type, double decayPercent) {
    const Voice& v = voiceOf(type);
    double d = std::isfinite(decayPercent) ? decayPercent : static_cast<double>(kDefaultDecayPercent);
    d = d < 0.0 ? 0.0 : (d > 100.0 ? 100.0 : d);
    return v.rtLo * std::pow(v.rtHi / v.rtLo, d / 100.0);
}

ReverbProcessor::ReverbProcessor()
    : tank_(static_cast<size_t>(kLineCount * kTankLineSize), 0.0f),
      preDelayLine_(static_cast<size_t>(kPreDelaySize), 0.0f),
      diffusers_(static_cast<size_t>(kDiffuserCount * kDiffuserSize), 0.0f),
      bloom_(static_cast<size_t>(kBloomCount * kBloomSize), 0.0f),
      shifters_(static_cast<size_t>(kShifterCount * kShifterSize), 0.0f),
      springs_(static_cast<size_t>(kSpringCount * kSpringLineSize), 0.0f),
      dispersion_(static_cast<size_t>(kSpringCount * (kDispersionStages + 1) * kDispersionSize), 0.0f) {
    prepare(48000.0, 128);
}

void ReverbProcessor::prepare(double sampleRate, int32_t /*maxBlockSize*/) {
    sampleRate_ = sampleRate > 0.0 && std::isfinite(sampleRate) ? sampleRate : 48000.0;
    const double perMs = sampleRate_ / 1000.0;

    wetGain_.prepare(sampleRate_, kMixSmoothingMs);
    dryGain_.prepare(sampleRate_, kMixSmoothingMs);
    inputGain_.prepare(sampleRate_, kInputFadeMs);
    preDelay_.prepare(sampleRate_, kPreDelaySmoothingMs);
    const double controlRate = sampleRate_ / kControlInterval;
    decay_.prepare(controlRate, kControlSmoothingMs);
    tone_.prepare(controlRate, kControlSmoothingMs);
    character_.prepare(controlRate, kControlSmoothingMs);

    fadeStep_ = static_cast<float>(1.0 / (kTypeFadeMs * perMs));
    idleAfterSamples_ = static_cast<int32_t>(kIdleAfterMs * perMs);

    // The early reflections read past the pre-delay, so both fit the line.
    for (int32_t k = 0; k < kEarlyTapCount; ++k) earlyDelay_[k] = static_cast<float>(kEarlyMs[k] * perMs);
    const float roomForPreDelay = static_cast<float>(kPreDelaySize - 4) - earlyDelay_[kEarlyTapCount - 1];
    maxPreDelay_ = std::min(static_cast<float>(kMaxPreDelayMs * perMs), roomForPreDelay);

    wetGain_.snapTo(0.0f);
    dryGain_.snapTo(1.0f);
    preDelay_.snapTo(std::min(static_cast<float>(kDefaultPreDelayMs * perMs), maxPreDelay_));
    decay_.snapTo(kDefaultDecayPercent);
    tone_.snapTo(kDefaultTonePercent);
    character_.snapTo(kDefaultCharacterPercent * 0.01f);

    voice(voiced_);
    reset();
}

void ReverbProcessor::reset() {
    clearState();
    primed_ = false;
    idle_ = false;
    quietSamples_ = 0;
    requested_ = voiced_;
    fade_ = 1.0f;
    inputGain_.snapTo(inputOpen_ ? 1.0f : 0.0f);
    controlCountdown_ = 0;
}

void ReverbProcessor::clearState() {
    std::fill(tank_.begin(), tank_.end(), 0.0f);
    std::fill(preDelayLine_.begin(), preDelayLine_.end(), 0.0f);
    std::fill(diffusers_.begin(), diffusers_.end(), 0.0f);
    std::fill(bloom_.begin(), bloom_.end(), 0.0f);
    std::fill(shifters_.begin(), shifters_.end(), 0.0f);
    std::fill(springs_.begin(), springs_.end(), 0.0f);
    std::fill(dispersion_.begin(), dispersion_.end(), 0.0f);
    tankWrite_ = preDelayWrite_ = diffuserWrite_ = bloomWrite_ = 0;
    shifterWrite_ = springWrite_ = dispersionWrite_ = 0;
    bandwidthZ_ = lowCutX1_ = lowCutY1_ = 0.0f;
    for (float& z : dampZ_) z = 0.0f;
    for (float& z : springDampZ_) z = 0.0f;
    for (int32_t i = 0; i < kLineCount; ++i) lfoPhase_[i] = static_cast<float>(i) / kLineCount;
    shifterPhase_ = 0.0f;
}

void ReverbProcessor::voice(Type type) {
    voiced_ = type;
    const Voice& v = voiceOf(type);
    const double perMs = sampleRate_ / 1000.0;

    // Room for the deepest sweep and the interpolating read, so a line can
    // never read past its buffer at any rate.
    const float longest = static_cast<float>(kTankLineSize - 4) - static_cast<float>(v.modMs * perMs);
    for (int32_t i = 0; i < kLineCount; ++i) {
        lineLength_[i] = std::min(static_cast<float>(kLineMs[i] * v.size * perMs), longest);
        lfoStep_[i] = static_cast<float>(v.modHz * kLfoRatio[i] / sampleRate_);
    }
    diffusion_ = v.diffusion;
    for (int32_t k = 0; k < kDiffuserCount; ++k) {
        diffuserLength_[k] = std::clamp(static_cast<int32_t>(std::lround(kDiffuserMs[k] * perMs)), 1, kDiffuserSize - 1);
    }
    for (int32_t k = 0; k < kBloomCount; ++k) {
        bloomLength_[k] = std::clamp(static_cast<int32_t>(std::lround(kBloomMs[k] * perMs)), 1, kBloomSize - 1);
    }
    // An octave up: the read points close on the write point one sample per
    // sample, so the window is crossed once every `window` samples.
    shifterWindow_ = std::min(static_cast<float>(kShifterMs * perMs), static_cast<float>(kShifterSize - 4));
    shifterStep_ = 1.0f / shifterWindow_;
    for (int32_t s = 0; s < kSpringCount; ++s) {
        springLength_[s] = std::clamp(static_cast<int32_t>(std::lround(kSpringMs[s] * perMs)), 1, kSpringLineSize - 1);
    }
    dispersionK_ = std::clamp(static_cast<int32_t>(std::lround(sampleRate_ / kDispersionHz)), 1, kDispersionSize - 1);
    controlCountdown_ = 0;
}

void ReverbProcessor::updateControls() {
    const Voice& v = voiceOf(voiced_);
    const double rate = sampleRate_;
    const double decay = decay_.next();
    const double tone = tone_.next() * 0.01;
    const float character = character_.next();

    const double rt = decaySeconds(voiced_, decay);
    const double hf = v.hfLo + (v.hfHi - v.hfLo) * tone;
    for (int32_t i = 0; i < kLineCount; ++i) absorption(lineLength_[i], rate, rt, hf, lineGain_[i], dampA_[i]);
    for (int32_t s = 0; s < kSpringCount; ++s) absorption(springLength_[s], rate, rt, hf, springGain_[s], springDampA_[s]);

    const double bandwidth = std::min(v.bandLo * std::pow(v.bandHi / v.bandLo, tone), 0.45 * rate);
    bandwidthA_ = onePoleA(bandwidth, rate);
    lowCutA_ = onePoleA(v.lowCutHz, rate);

    modDepth_ = static_cast<float>((v.modKnob ? v.modMs * character : v.modMs) * rate / 1000.0);
    early_ = voiced_ == Type::Room ? character : 0.0f;
    shimmer_ = voiced_ == Type::Shimmer ? 0.7f * character : 0.0f;
    bloomMix_ = voiced_ == Type::Ambient ? character : 0.0f;
    bloomG_ = 0.55f + 0.2f * character;
    springA_ = 0.3f + 0.45f * character;

    // A long DECAY rings longer and so builds louder; take the edge off it so
    // the top of the knob does not swamp the dry signal.
    const double compensation = std::pow(rt / decaySeconds(voiced_, kDefaultDecayPercent), -0.25);
    outGain_ = static_cast<float>(v.outGain * compensation);
}

void ReverbProcessor::setInputOpen(bool open) {
    inputOpen_ = open;
    inputGain_.setTarget(open ? 1.0f : 0.0f);
    const float m = mixTarget_;
    dryGain_.setTarget(open ? (m <= 0.5f ? 1.0f : 2.0f * (1.0f - m)) : 1.0f);
    if (open) {
        idle_ = false;
        quietSamples_ = 0;
    }
}

void ReverbProcessor::setParams(const float* params) {
    // A value that is not finite reads as the default; a clamp alone would
    // turn +inf into the maximum.
    const float mix = clampf(finiteOr(params[0], kDefaultMixPercent), 0.0f, 100.0f) * 0.01f;
    const float decay = clampf(finiteOr(params[1], kDefaultDecayPercent), 0.0f, 100.0f);
    const float tone = clampf(finiteOr(params[2], kDefaultTonePercent), 0.0f, 100.0f);
    const float preDelayMs = clampf(finiteOr(params[3], kDefaultPreDelayMs), 0.0f, kMaxPreDelayMs);
    const float character = clampf(finiteOr(params[4], kDefaultCharacterPercent), 0.0f, 100.0f) * 0.01f;
    const float rawType = finiteOr(params[5], static_cast<float>(kDefaultType));
    const Type type = static_cast<Type>(static_cast<int32_t>(std::lround(clampf(rawType, 0.0f, kTypeCount - 1.0f))));

    mixTarget_ = mix;
    const float wet = mix < 0.5f ? 2.0f * mix : 1.0f;
    const float dry = inputOpen_ ? (mix <= 0.5f ? 1.0f : 2.0f * (1.0f - mix)) : 1.0f;
    const float preDelay = std::min(static_cast<float>(preDelayMs * sampleRate_ / 1000.0), maxPreDelay_);

    wetGain_.setTarget(wet);
    dryGain_.setTarget(dry);
    preDelay_.setTarget(preDelay);
    decay_.setTarget(decay);
    tone_.setTarget(tone);
    character_.setTarget(character);
    requested_ = type;

    if (!primed_) {
        // The chain only calls setParams() on an enabled stage, so after a
        // reset the targets are stale; the first real ones take effect at once.
        wetGain_.snapTo(wet);
        dryGain_.snapTo(dry);
        preDelay_.snapTo(preDelay);
        decay_.snapTo(decay);
        tone_.snapTo(tone);
        character_.snapTo(character);
        if (type != voiced_) voice(type);
        fade_ = 1.0f;
        controlCountdown_ = 0;
        primed_ = true;
    }
}

void ReverbProcessor::process(float* buffer, int32_t numFrames) {
    if (idle_) return;

    constexpr int32_t kTankMask = kTankLineSize - 1;
    constexpr int32_t kPreDelayMask = kPreDelaySize - 1;
    constexpr int32_t kDiffuserMask = kDiffuserSize - 1;
    constexpr int32_t kBloomMask = kBloomSize - 1;
    constexpr int32_t kShifterMask = kShifterSize - 1;
    constexpr int32_t kSpringMask = kSpringLineSize - 1;
    constexpr int32_t kDispersionMask = kDispersionSize - 1;

    for (int32_t n = 0; n < numFrames; ++n) {
        // A type change: fade the old type's wet out, then clear and voice the
        // new one. The tank is empty then, so the wet comes back at full gain
        // without a step; the input is faded back in so nothing downstream
        // starts on a step either. Back to the voiced type mid-fade: fade in.
        if (requested_ != voiced_) {
            fade_ -= fadeStep_;
            if (fade_ <= 0.0f) {
                clearState();
                voice(requested_);
                // Shut, then aimed back where it belongs, so it ramps open
                // again. snapTo() alone also moves the target, and would leave
                // the new type deaf for good.
                inputGain_.snapTo(0.0f);
                inputGain_.setTarget(inputOpen_ ? 1.0f : 0.0f);
                fade_ = 1.0f;
            }
        } else if (fade_ < 1.0f) {
            fade_ = std::min(1.0f, fade_ + fadeStep_);
        }

        if (--controlCountdown_ < 0) {
            updateControls();
            controlCountdown_ = kControlInterval - 1;
        }

        float x = buffer[n];
        // NaN, +inf and -inf all become zero, as do values too small to matter.
        if (!std::isfinite(x) || std::fabs(x) < kFlush) x = 0.0f;

        // Input gate, bandwidth and pre-delay.
        bandwidthZ_ = flush(x * inputGain_.next() * (1.0f - bandwidthA_) + bandwidthA_ * bandwidthZ_);
        preDelayLine_[preDelayWrite_] = bandwidthZ_;
        const float preDelay = preDelay_.next();
        const float delayed = readAt(preDelayLine_.data(), kPreDelayMask, preDelayWrite_, preDelay);

        float wet = 0.0f;
        if (early_ > 0.0f) {
            float early = 0.0f;
            for (int32_t k = 0; k < kEarlyTapCount; ++k) {
                early += kEarlyGain[k] * readAt(preDelayLine_.data(), kPreDelayMask, preDelayWrite_, preDelay + earlyDelay_[k]);
            }
            wet += early_ * early;
        }

        float u = delayed;

        if (voiced_ == Type::Spring) {
            // Two springs: a loop each, its feedback through a chain of
            // stretched all-passes that delays the highs more than the lows.
            float springOut = 0.0f;
            const int32_t k = dispersionK_;
            const float a = springA_;
            for (int32_t s = 0; s < kSpringCount; ++s) {
                float* line = springs_.data() + s * kSpringLineSize;
                const float back = line[(springWrite_ - springLength_[s]) & kSpringMask];
                springOut += back;
                springDampZ_[s] = flush(back + springDampA_[s] * (springDampZ_[s] - back));
                float v = u + springGain_[s] * springDampZ_[s];
                float* hist = dispersion_.data() + s * (kDispersionStages + 1) * kDispersionSize;
                for (int32_t j = 0; j < kDispersionStages; ++j) {
                    float* in = hist + j * kDispersionSize;
                    const float* out = in + kDispersionSize;
                    const float inK = in[(dispersionWrite_ - k) & kDispersionMask];
                    const float outK = out[(dispersionWrite_ - k) & kDispersionMask];
                    in[dispersionWrite_] = v;
                    v = flush(a * v + inK - a * outK);
                }
                hist[kDispersionStages * kDispersionSize + dispersionWrite_] = v;
                line[springWrite_] = v;
            }
            springOut *= 0.5f;
            springWrite_ = (springWrite_ + 1) & kSpringMask;
            dispersionWrite_ = (dispersionWrite_ + 1) & kDispersionMask;
            wet += springOut;
            u = springOut;
        }

        if (voiced_ == Type::Ambient) {
            // Always run, so raising BLOOM never reads a stale line.
            float b = u;
            for (int32_t k = 0; k < kBloomCount; ++k) {
                b = allpass(bloom_.data() + k * kBloomSize, kBloomMask, bloomWrite_, bloomLength_[k], bloomG_, b);
            }
            bloomWrite_ = (bloomWrite_ + 1) & kBloomMask;
            u += bloomMix_ * (b - u);
        }

        if (diffusion_ > 0.0f) {
            for (int32_t k = 0; k < kDiffuserCount; ++k) {
                u = allpass(diffusers_.data() + k * kDiffuserSize, kDiffuserMask, diffuserWrite_, diffuserLength_[k], diffusion_, u);
            }
            diffuserWrite_ = (diffuserWrite_ + 1) & kDiffuserMask;
        }

        // The tank.
        float o[kLineCount];
        for (int32_t i = 0; i < kLineCount; ++i) {
            float phase = lfoPhase_[i] + lfoStep_[i];
            if (phase >= 1.0f) phase -= 1.0f;
            lfoPhase_[i] = phase;
            const float d = lineLength_[i] + modDepth_ * sinPi(2.0f * phase - 1.0f);
            const float r = readAt(tank_.data() + i * kTankLineSize, kTankMask, tankWrite_, d);
            dampZ_[i] = flush(r + dampA_[i] * (dampZ_[i] - r));
            o[i] = dampZ_[i] * lineGain_[i];
        }

        if (voiced_ == Type::Shimmer) {
            // Two taps sweep the window at twice the write rate, half a window
            // apart. Each is weighted to zero where it jumps back, and the
            // weights always sum to one, so the shifted copy is a convex mix
            // of past samples and the loop cannot gain energy.
            for (int32_t i = 0; i < kShifterCount; ++i) {
                float* line = shifters_.data() + i * kShifterSize;
                line[shifterWrite_] = o[i];
                // Staggered, so the eight windows never all turn over together.
                float p = shifterPhase_ + 0.125f * static_cast<float>(i);
                if (p >= 1.0f) p -= 1.0f;
                float q = p + 0.5f;
                if (q >= 1.0f) q -= 1.0f;
                const float bump = 4.0f * p * (1.0f - p);
                const float w = bump * bump;
                const float first = readAt(line, kShifterMask, shifterWrite_, 1.0f + shifterWindow_ * (1.0f - p));
                const float second = readAt(line, kShifterMask, shifterWrite_, 1.0f + shifterWindow_ * (1.0f - q));
                const float shifted = w * first + (1.0f - w) * second;
                o[i] += shimmer_ * (shifted - o[i]);
            }
            shifterWrite_ = (shifterWrite_ + 1) & kShifterMask;
            shifterPhase_ += shifterStep_;
            if (shifterPhase_ >= 1.0f) shifterPhase_ -= 1.0f;
        }

        float tankOut = 0.0f;
        for (int32_t i = 0; i < kLineCount; ++i) tankOut += kOutSign[i] * o[i];
        tankOut *= kTankOutGain;
        wet += voiced_ == Type::Spring ? kSpringBody * tankOut : tankOut;

        hadamard8(o);
        const float inject = u * kInjectGain;
        for (int32_t i = 0; i < kLineCount; ++i) {
            tank_[static_cast<size_t>(i * kTankLineSize + tankWrite_)] = flush(o[i] + kInSign[i] * inject);
        }
        tankWrite_ = (tankWrite_ + 1) & kTankMask;
        preDelayWrite_ = (preDelayWrite_ + 1) & kPreDelayMask;

        // The low cut, then the type's level.
        const float lowCut = flush(lowCutA_ * (lowCutY1_ + wet - lowCutX1_));
        lowCutX1_ = wet;
        lowCutY1_ = lowCut;
        wet = lowCut * outGain_;

        if (!inputOpen_) {
            quietSamples_ = std::fabs(wet) < kIdleThreshold ? quietSamples_ + 1 : 0;
        }

        buffer[n] = x * dryGain_.next() + wet * wetGain_.next() * fade_;
    }

    // Closed, silent for long enough, and the dry back at exactly full level:
    // from here on the buffer passes untouched without running anything.
    if (!inputOpen_ && quietSamples_ >= idleAfterSamples_ && dryGain_.current() == 1.0f) idle_ = true;
}

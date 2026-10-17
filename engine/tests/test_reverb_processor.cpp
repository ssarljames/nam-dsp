#include "ReverbProcessor.h"
#include "test_util.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <string>
#include <vector>

namespace {

using Type = ReverbProcessor::Type;

constexpr double kRate = 48000.0;
constexpr int kBlock = 128;
constexpr double kPi = 3.141592653589793;

constexpr Type kTypes[] = {Type::Room, Type::Hall, Type::Plate, Type::Spring, Type::Shimmer, Type::Ambient};
const char* const kTypeNames[] = {"ROOM", "HALL", "PLATE", "SPRING", "SHIMMER", "AMBIENT"};

struct Settings {
    float mix = ReverbProcessor::kDefaultMixPercent;
    float decay = ReverbProcessor::kDefaultDecayPercent;
    float tone = ReverbProcessor::kDefaultTonePercent;
    float preDelay = ReverbProcessor::kDefaultPreDelayMs;
    float character = ReverbProcessor::kDefaultCharacterPercent;
    Type type = ReverbProcessor::kDefaultType;
};

void configure(ReverbProcessor& r, const Settings& s) {
    const float params[6] = {s.mix, s.decay, s.tone, s.preDelay, s.character, static_cast<float>(s.type)};
    r.setParams(params);
}

/** A prepared reverb with `s` already applied (the first params after a reset snap). */
void start(ReverbProcessor& r, const Settings& s, double rate = kRate) {
    r.prepare(rate, kBlock);
    configure(r, s);
}

/** Processes `data` in blocks of kBlock, re-sending `s` before each block as the chain does. */
std::vector<float> run(ReverbProcessor& r, std::vector<float> data, const Settings& s) {
    for (size_t at = 0; at < data.size(); at += static_cast<size_t>(kBlock)) {
        const int n = static_cast<int>(std::min<size_t>(static_cast<size_t>(kBlock), data.size() - at));
        configure(r, s);
        r.process(data.data() + at, n);
    }
    return data;
}

std::vector<float> impulse(size_t length) {
    std::vector<float> x(length, 0.0f);
    x[0] = 1.0f;
    return x;
}

/** Deterministic white noise in [-amp, amp). */
std::vector<float> noise(size_t length, float amp, uint32_t seed = 12345u) {
    std::vector<float> x(length);
    uint32_t state = seed;
    for (float& v : x) {
        state = state * 1664525u + 1013904223u;
        v = amp * (static_cast<float>(state >> 8) / 8388608.0f - 1.0f);
    }
    return x;
}

std::vector<float> sine(size_t length, double hz, float amp, double rate = kRate) {
    std::vector<float> x(length);
    for (size_t i = 0; i < length; ++i) x[i] = amp * static_cast<float>(std::sin(2.0 * kPi * hz * static_cast<double>(i) / rate));
    return x;
}

size_t samples(double seconds, double rate = kRate) { return static_cast<size_t>(seconds * rate); }

double energy(const std::vector<float>& x, size_t from, size_t to) {
    double e = 0.0;
    for (size_t i = from; i < to && i < x.size(); ++i) e += static_cast<double>(x[i]) * x[i];
    return e;
}

double rms(const std::vector<float>& x, size_t from, size_t to) {
    return std::sqrt(energy(x, from, to) / static_cast<double>(to - from));
}

double db(double ratio) { return 10.0 * std::log10(ratio); }

bool allFinite(const std::vector<float>& x) {
    return std::all_of(x.begin(), x.end(), [](float v) { return std::isfinite(v); });
}

float peak(const std::vector<float>& x, size_t from = 0) {
    float p = 0.0f;
    for (size_t i = from; i < x.size(); ++i) p = std::max(p, std::fabs(x[i]));
    return p;
}

/** A second-order Butterworth low-pass (RBJ), applied in double. */
std::vector<double> lowPass(const std::vector<float>& x, double hz, double rate = kRate) {
    const double w = 2.0 * kPi * hz / rate;
    const double alpha = std::sin(w) / (2.0 * 0.7071067811865476);
    const double cw = std::cos(w);
    const double a0 = 1.0 + alpha;
    const double b0 = (1.0 - cw) / 2.0 / a0, b1 = (1.0 - cw) / a0, b2 = b0;
    const double a1 = -2.0 * cw / a0, a2 = (1.0 - alpha) / a0;
    std::vector<double> y(x.size());
    double x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (size_t i = 0; i < x.size(); ++i) {
        const double v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x[i];
        y2 = y1;
        y1 = v;
        y[i] = v;
    }
    return y;
}

/**
 * T30 of an impulse response: the time its Schroeder energy decay curve takes
 * from -5 to -35 dB, doubled. Measured below about 1 kHz, where TONE does not
 * shorten the decay, so it reads the RT60 that DECAY sets.
 */
double t30(const std::vector<float>& ir, double rate = kRate) {
    const std::vector<double> y = lowPass(ir, 1000.0, rate);
    std::vector<double> edc(y.size() + 1, 0.0);
    for (size_t i = y.size(); i-- > 0;) edc[i] = edc[i + 1] + y[i] * y[i];
    const double total = edc[0];
    size_t n5 = 0, n35 = 0;
    for (size_t i = 0; i < y.size(); ++i) {
        const double level = db(edc[i] / total);
        if (n5 == 0 && level <= -5.0) n5 = i;
        if (level <= -35.0) {
            n35 = i;
            break;
        }
    }
    if (n5 == 0 || n35 == 0) return -1.0;
    return 2.0 * static_cast<double>(n35 - n5) / rate;
}

/** The power of `hz` in x[from, to), by Goertzel. */
double tonePower(const std::vector<float>& x, size_t from, size_t to, double hz, double rate = kRate) {
    const double coeff = 2.0 * std::cos(2.0 * kPi * hz / rate);
    double s1 = 0.0, s2 = 0.0;
    for (size_t i = from; i < to; ++i) {
        const double s = x[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s;
    }
    return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

double worstStep(const std::vector<float>& x, size_t from, size_t to) {
    double worst = 0.0;
    for (size_t i = std::max<size_t>(from, 1); i < to; ++i) worst = std::max(worst, std::fabs(static_cast<double>(x[i]) - x[i - 1]));
    return worst;
}

void fail(const std::string& what) { testutil::report(__FILE__, __LINE__, what); }

}  // namespace

static void decay_maps_each_types_range_logarithmically() {
    CHECK_CLOSE(ReverbProcessor::decaySeconds(Type::Hall, 0.0), 0.8, 1e-9);
    CHECK_CLOSE(ReverbProcessor::decaySeconds(Type::Hall, 100.0), 10.0, 1e-9);
    CHECK_CLOSE(ReverbProcessor::decaySeconds(Type::Hall, 50.0), std::sqrt(8.0), 1e-9);
    CHECK_CLOSE(ReverbProcessor::decaySeconds(Type::Room, 0.0), 0.2, 1e-9);
    CHECK_CLOSE(ReverbProcessor::decaySeconds(Type::Ambient, 100.0), 30.0, 1e-9);
    // Clamped, and a NaN reads as the default.
    CHECK_CLOSE(ReverbProcessor::decaySeconds(Type::Hall, 500.0), 10.0, 1e-9);
    CHECK_CLOSE(ReverbProcessor::decaySeconds(Type::Hall, -5.0), 0.8, 1e-9);
    CHECK_CLOSE(ReverbProcessor::decaySeconds(Type::Hall, std::nan("")), std::sqrt(8.0), 1e-9);
}

static void a_mix_of_zero_leaves_the_signal_unchanged() {
    for (Type type : kTypes) {
        ReverbProcessor r;
        Settings s;
        s.mix = 0.0f;
        s.type = type;
        start(r, s);
        const auto in = noise(samples(1.0), 0.5f);
        const auto out = run(r, in, s);
        for (size_t i = 0; i < in.size(); ++i) {
            if (out[i] != in[i]) {
                fail(std::string("mix 0 changed the signal for ") + kTypeNames[static_cast<int>(type)]);
                break;
            }
        }
    }
}

static void a_mix_of_half_keeps_the_dry_signal_at_full_level() {
    ReverbProcessor r;
    Settings s;
    s.mix = 50.0f;
    s.preDelay = 10.0f;
    start(r, s);
    const auto out = run(r, impulse(samples(0.5)), s);
    CHECK(out[0] == 1.0f);
    // ...and the reverb arrives on top of it.
    CHECK(energy(out, 1, out.size()) > 1e-3);
}

static void a_full_mix_removes_the_dry_signal_and_nothing_comes_before_the_pre_delay() {
    for (Type type : kTypes) {
        ReverbProcessor r;
        Settings s;
        s.mix = 100.0f;
        s.preDelay = 100.0f;
        s.type = type;
        start(r, s);
        const auto out = run(r, impulse(samples(1.0)), s);
        const size_t pre = samples(0.1);
        bool silent = true;
        for (size_t i = 0; i < pre; ++i) silent = silent && out[i] == 0.0f;
        if (!silent) fail(std::string("output before the pre-delay for ") + kTypeNames[static_cast<int>(type)]);
        if (!(energy(out, pre, out.size()) > 1e-4)) fail(std::string("no reverb after the pre-delay for ") + kTypeNames[static_cast<int>(type)]);
    }
}

static void the_decay_time_matches_decay_for_every_type() {
    for (Type type : kTypes) {
        for (float decay : {0.0f, 50.0f, 100.0f}) {
            ReverbProcessor r;
            Settings s;
            s.mix = 100.0f;
            s.decay = decay;
            s.tone = 100.0f;
            s.preDelay = 0.0f;
            s.character = 0.0f;
            s.type = type;
            start(r, s);
            const double target = ReverbProcessor::decaySeconds(type, decay);
            const auto ir = run(r, impulse(samples(1.5 * target + 0.5)), s);
            const double measured = t30(ir);
            if (!(measured > 0.7 * target && measured < 1.3 * target)) {
                fail(std::string("T30 ") + std::to_string(measured) + " s against " + std::to_string(target) +
                     " s for " + kTypeNames[static_cast<int>(type)] + " at decay " + std::to_string(decay));
            }
        }
    }
}

static void every_type_stays_stable_with_every_knob_at_its_maximum() {
    for (Type type : kTypes) {
        ReverbProcessor r;
        Settings s;
        s.mix = 100.0f;
        s.decay = 100.0f;
        s.tone = 100.0f;
        s.preDelay = ReverbProcessor::kMaxPreDelayMs;
        s.character = 100.0f;
        s.type = type;
        start(r, s);
        std::vector<float> in = noise(samples(10.0), 0.5f);
        in.resize(samples(40.0), 0.0f);
        const auto out = run(r, in, s);
        const char* name = kTypeNames[static_cast<int>(type)];
        if (!allFinite(out)) fail(std::string("non-finite output for ") + name);
        if (!(peak(out) < 8.0f)) fail(std::string("peak ") + std::to_string(peak(out)) + " for " + name);
        const double first = rms(out, samples(10.0), samples(11.0));
        const double last = rms(out, samples(39.0), samples(40.0));
        if (!(last < first * 0.1)) {
            fail(std::string("the tail does not die away for ") + name + ": " + std::to_string(first) + " then " +
                 std::to_string(last));
        }
    }
}

static void a_tail_decays_to_exact_zeros() {
    for (Type type : kTypes) {
        ReverbProcessor r;
        Settings s;
        s.mix = 100.0f;
        s.decay = 0.0f;
        s.type = type;
        start(r, s);
        std::vector<float> in = noise(samples(0.5), 0.5f);
        in.resize(samples(30.0), 0.0f);
        const auto out = run(r, in, s);
        bool zeros = true;
        for (size_t i = out.size() - 4096; i < out.size(); ++i) zeros = zeros && out[i] == 0.0f;
        if (!zeros) fail(std::string("the tail does not end in exact zeros for ") + kTypeNames[static_cast<int>(type)]);
    }
}

static void non_finite_and_absurd_params_read_as_safe_values() {
    const float bad[] = {std::numeric_limits<float>::quiet_NaN(), std::numeric_limits<float>::infinity(),
                         -std::numeric_limits<float>::infinity(), 1.0e30f, -1.0e30f};
    for (float v : bad) {
        for (int p = 0; p < 6; ++p) {
            ReverbProcessor r;
            r.prepare(kRate, kBlock);
            float params[6] = {50.0f, 100.0f, 50.0f, 50.0f, 100.0f, 4.0f};
            params[p] = v;
            std::vector<float> data = noise(samples(1.0), 0.5f);
            for (size_t at = 0; at < data.size(); at += kBlock) {
                r.setParams(params);
                r.process(data.data() + at, static_cast<int32_t>(std::min<size_t>(kBlock, data.size() - at)));
            }
            if (!allFinite(data)) fail("non-finite output for a bad param " + std::to_string(p));
            if (!(peak(data) < 8.0f)) fail("runaway output for a bad param " + std::to_string(p));
        }
    }
    // A type that is not a number reads as the default; one out of range is clamped.
    ReverbProcessor r;
    r.prepare(kRate, kBlock);
    float params[6] = {50.0f, 50.0f, 50.0f, 20.0f, 50.0f, std::numeric_limits<float>::quiet_NaN()};
    r.setParams(params);
    CHECK(r.type() == ReverbProcessor::kDefaultType);
    r.reset();
    params[5] = 99.0f;
    r.setParams(params);
    CHECK(r.type() == Type::Ambient);
    r.reset();
    params[5] = -3.0f;
    r.setParams(params);
    CHECK(r.type() == Type::Room);
    r.reset();
    params[5] = 2.4f;
    r.setParams(params);
    CHECK(r.type() == Type::Plate);
}

static void a_non_finite_input_sample_cannot_poison_the_reverb() {
    for (Type type : kTypes) {
        ReverbProcessor r;
        Settings s;
        s.mix = 50.0f;
        s.type = type;
        start(r, s);
        std::vector<float> in = noise(samples(3.0), 0.3f);
        in[1000] = std::numeric_limits<float>::quiet_NaN();
        in[2000] = std::numeric_limits<float>::infinity();
        in[3000] = -std::numeric_limits<float>::infinity();
        const auto out = run(r, in, s);
        const char* name = kTypeNames[static_cast<int>(type)];
        if (!allFinite(out)) fail(std::string("a non-finite input poisoned ") + name);
        // ...and it is still a reverb afterwards.
        double wet = 0.0;
        for (size_t i = samples(2.0); i < out.size(); ++i) wet += std::fabs(static_cast<double>(out[i]) - in[i]);
        if (!(wet > 1.0)) fail(std::string("no reverb after a non-finite input for ") + name);
    }
}

static void every_type_is_finite_and_in_bounds_at_44_1_48_96_and_192_khz() {
    for (double rate : {44100.0, 48000.0, 96000.0, 192000.0}) {
        for (Type type : kTypes) {
            ReverbProcessor r;
            Settings s;
            s.mix = 100.0f;
            s.decay = 100.0f;
            s.preDelay = ReverbProcessor::kMaxPreDelayMs;
            s.character = 100.0f;
            s.type = type;
            start(r, s, rate);
            const auto out = run(r, noise(samples(2.0, rate), 0.5f), s);
            if (!allFinite(out)) {
                fail(std::string("non-finite at ") + std::to_string(rate) + " for " + kTypeNames[static_cast<int>(type)]);
            }
        }
    }
    // The pre-delay is exact at 96 kHz too.
    ReverbProcessor r;
    Settings s;
    s.mix = 100.0f;
    s.preDelay = 100.0f;
    start(r, s, 96000.0);
    const auto out = run(r, impulse(samples(0.5, 96000.0)), s);
    bool silent = true;
    for (size_t i = 0; i < 9600; ++i) silent = silent && out[i] == 0.0f;
    CHECK(silent);
    CHECK(energy(out, 9600, out.size()) > 1e-4);
}

static void a_type_change_restarts_the_tail_without_a_click() {
    ReverbProcessor r;
    Settings s;
    s.mix = 100.0f;
    s.type = Type::Hall;
    start(r, s);
    const auto in = sine(samples(3.0), 220.0, 0.5f);
    std::vector<float> out = in;
    const size_t at = samples(2.0);
    const size_t fade = samples(ReverbProcessor::kTypeFadeMs / 1000.0);
    Settings later = s;
    later.type = Type::Plate;
    bool voicedLate = false, voicedEarly = false;
    for (size_t pos = 0; pos < out.size(); pos += kBlock) {
        const Settings& now = pos < at ? s : later;
        configure(r, now);
        r.process(out.data() + pos, static_cast<int32_t>(std::min<size_t>(kBlock, out.size() - pos)));
        const size_t end = pos + kBlock;
        if (end > at && end < at + fade - kBlock && r.type() == Type::Plate) voicedEarly = true;
        if (end >= at + fade + kBlock && r.type() == Type::Plate) voicedLate = true;
    }
    CHECK(!voicedEarly);  // the old type runs through its fade...
    CHECK(voicedLate);    // ...and the new one is voiced right after it
    // The old type fades out without a step bigger than its own steady signal
    // makes, and the new one starts from silence and builds smoothly. (The new
    // type's steady sound is not compared: a brighter type simply has bigger
    // steps, which is not a click.)
    const double before = worstStep(out, at - samples(0.5), at);
    const double fadingOut = worstStep(out, at, at + fade);
    const double restarting = worstStep(out, at + fade, at + fade + samples(0.07));
    if (!(fadingOut <= before * 1.05)) {
        fail("fade-out step " + std::to_string(fadingOut) + " against a steady " + std::to_string(before));
    }
    if (!(restarting <= before * 0.25)) {
        fail("restart step " + std::to_string(restarting) + " against a steady " + std::to_string(before));
    }
    // ...and it does come back.
    CHECK(rms(out, out.size() - samples(0.5), out.size()) > 0.25 * rms(out, at - samples(0.5), at));
}

static void after_a_type_change_the_new_type_reverberates() {
    // Every type into every other: once the fade is over the new type must
    // take input again, not sit silent with its input gate shut.
    for (Type from : kTypes) {
        for (Type to : kTypes) {
            if (from == to) continue;
            ReverbProcessor r;
            Settings s;
            s.mix = 100.0f;
            s.type = from;
            start(r, s);
            const auto in = noise(samples(3.0), 0.3f);
            std::vector<float> out = in;
            const size_t at = samples(1.0);
            Settings later = s;
            later.type = to;
            for (size_t pos = 0; pos < out.size(); pos += kBlock) {
                configure(r, pos < at ? s : later);
                r.process(out.data() + pos, static_cast<int32_t>(std::min<size_t>(kBlock, out.size() - pos)));
            }
            // MIX 100: all of this is the reverb. A second after the change it
            // must be within 12 dB of the input, like at default settings.
            const double ratio = db(energy(out, samples(2.0), samples(3.0)) / energy(in, samples(2.0), samples(3.0)));
            if (!(ratio > -12.0)) {
                fail(std::string("after ") + kTypeNames[static_cast<int>(from)] + " -> " + kTypeNames[static_cast<int>(to)] +
                     " the wet is " + std::to_string(ratio) + " dB");
            }
        }
    }
}

static void a_type_change_reversed_mid_fade_fades_back_in() {
    ReverbProcessor r;
    Settings s;
    s.mix = 100.0f;
    start(r, s);
    std::vector<float> out = sine(samples(2.0), 220.0, 0.5f);
    Settings other = s;
    other.type = Type::Room;
    const size_t at = samples(1.5);
    for (size_t pos = 0; pos < out.size(); pos += kBlock) {
        // One block of ROOM, then back to HALL.
        configure(r, pos == at - at % kBlock ? other : s);
        r.process(out.data() + pos, static_cast<int32_t>(std::min<size_t>(kBlock, out.size() - pos)));
    }
    CHECK(r.type() == Type::Hall);
    // The tail was never cleared: it is still there at full strength.
    CHECK(rms(out, out.size() - 4800, out.size()) > 0.5 * rms(out, at - 9600, at - 4800));
}

static void with_the_input_closed_the_dry_passes_untouched_and_nothing_enters() {
    for (Type type : kTypes) {
        ReverbProcessor r;
        Settings s;
        s.mix = 100.0f;
        s.type = type;
        // Closed before it starts, as the engine does when it enables a
        // bypassed reverb with trails on: the input gate is already shut.
        r.setInputOpen(false);
        start(r, s);
        const auto in = noise(samples(1.0), 0.5f);
        const auto out = run(r, in, s);
        bool same = true;
        for (size_t i = 0; i < in.size(); ++i) same = same && out[i] == in[i];
        if (!same) fail(std::string("a closed reverb changed the signal for ") + kTypeNames[static_cast<int>(type)]);
    }
}

static void closing_the_input_lets_the_tail_ring_out() {
    ReverbProcessor r;
    Settings s;
    s.mix = 100.0f;
    start(r, s);
    auto played = run(r, noise(samples(1.0), 0.5f), s);
    r.setInputOpen(false);
    const auto after = run(r, std::vector<float>(samples(1.0), 0.0f), s);
    // The tail goes on after the input closes, and dies away.
    CHECK(rms(after, 0, samples(0.1)) > 0.3 * rms(played, samples(0.9), samples(1.0)));
    CHECK(rms(after, samples(0.9), samples(1.0)) < rms(after, 0, samples(0.1)));
    CHECK(!r.idle());
}

static void a_closed_reverb_goes_idle_once_its_tail_is_silent_and_wakes_when_opened() {
    ReverbProcessor r;
    Settings s;
    s.mix = 100.0f;
    s.decay = 0.0f;
    start(r, s);
    run(r, noise(samples(0.5), 0.5f), s);
    r.setInputOpen(false);
    run(r, std::vector<float>(samples(4.0), 0.0f), s);
    CHECK(r.idle());
    // Idle: the buffer is left exactly as it was.
    const auto in = noise(samples(0.5), 0.5f, 999u);
    const auto out = run(r, in, s);
    bool same = true;
    for (size_t i = 0; i < in.size(); ++i) same = same && out[i] == in[i];
    CHECK(same);
    // Opened again: awake, and reverberating.
    r.setInputOpen(true);
    CHECK(!r.idle());
    const auto woken = run(r, noise(samples(1.0), 0.5f, 7u), s);
    double wet = 0.0;
    for (size_t i = samples(0.5); i < woken.size(); ++i) wet += std::fabs(woken[i]);
    CHECK(wet > 1.0);
}

static void an_open_reverb_never_goes_idle_in_silence() {
    ReverbProcessor r;
    Settings s;
    start(r, s);
    run(r, std::vector<float>(samples(2.0), 0.0f), s);
    CHECK(!r.idle());
}

static void shimmer_adds_the_octave_above() {
    auto octaveRatio = [](float shimmer) {
        ReverbProcessor r;
        Settings s;
        s.mix = 100.0f;
        s.type = Type::Shimmer;
        s.character = shimmer;
        start(r, s);
        const auto out = run(r, sine(samples(3.0), 220.0, 0.3f), s);
        return tonePower(out, samples(1.0), samples(3.0), 440.0) / tonePower(out, samples(1.0), samples(3.0), 220.0);
    };
    const double none = octaveRatio(0.0f);
    const double full = octaveRatio(100.0f);
    if (!(db(full / none) > 10.0)) {
        fail("shimmer raises the octave by only " + std::to_string(db(full / none)) + " dB");
    }
}

static void bloom_moves_the_energy_later() {
    auto earlyToLate = [](float bloom) {
        ReverbProcessor r;
        Settings s;
        s.mix = 100.0f;
        s.preDelay = 0.0f;
        s.type = Type::Ambient;
        s.character = bloom;
        start(r, s);
        const auto out = run(r, impulse(samples(2.0)), s);
        return energy(out, 0, samples(0.1)) / energy(out, samples(0.5), samples(1.0));
    };
    const double none = earlyToLate(0.0f);
    const double full = earlyToLate(100.0f);
    if (!(db(none / full) > 3.0)) fail("bloom moves the energy later by only " + std::to_string(db(none / full)) + " dB");
}

static void early_reflections_add_energy_in_the_first_40_ms() {
    auto firstForty = [](float early) {
        ReverbProcessor r;
        Settings s;
        s.mix = 100.0f;
        s.preDelay = 0.0f;
        s.type = Type::Room;
        s.character = early;
        start(r, s);
        const auto out = run(r, impulse(samples(1.0)), s);
        return energy(out, 0, samples(0.04));
    };
    const double none = firstForty(0.0f);
    const double full = firstForty(100.0f);
    if (!(db(full / none) > 3.0)) fail("EARLY adds only " + std::to_string(db(full / none)) + " dB");
}

static void drip_changes_the_spring() {
    auto springOf = [](float drip) {
        ReverbProcessor r;
        Settings s;
        s.mix = 100.0f;
        s.preDelay = 0.0f;
        s.type = Type::Spring;
        s.character = drip;
        start(r, s);
        return run(r, impulse(samples(1.0)), s);
    };
    const auto none = springOf(0.0f);
    const auto full = springOf(100.0f);
    CHECK(allFinite(none) && allFinite(full));
    double diff = 0.0;
    for (size_t i = 0; i < none.size(); ++i) diff += (static_cast<double>(full[i]) - none[i]) * (static_cast<double>(full[i]) - none[i]);
    CHECK(diff > 0.1 * energy(none, 0, none.size()));
}

static void at_default_settings_the_wet_level_is_close_to_the_input_level() {
    for (Type type : kTypes) {
        ReverbProcessor r;
        Settings s;
        s.mix = 100.0f;
        s.type = type;
        start(r, s);
        const double rt = ReverbProcessor::decaySeconds(type, s.decay);
        const auto in = noise(samples(rt + 2.0), 0.1f);
        const auto out = run(r, in, s);
        const double ratio = db(energy(out, out.size() - samples(2.0), out.size()) / energy(in, in.size() - samples(2.0), in.size()));
        if (!(std::fabs(ratio) < 4.0)) {
            fail(std::string("wet is ") + std::to_string(ratio) + " dB from the input for " + kTypeNames[static_cast<int>(type)]);
        }
    }
}

static void reset_clears_everything_and_the_next_params_take_effect_at_once() {
    ReverbProcessor r;
    Settings s;
    s.mix = 100.0f;
    start(r, s);
    run(r, noise(samples(1.0), 0.5f), s);
    r.reset();
    Settings plate = s;
    plate.type = Type::Plate;
    configure(r, plate);
    CHECK(r.type() == Type::Plate);
    const auto out = run(r, std::vector<float>(samples(0.5), 0.0f), plate);
    CHECK(peak(out) == 0.0f);
}

static void run_tests() {
    decay_maps_each_types_range_logarithmically();
    a_mix_of_zero_leaves_the_signal_unchanged();
    a_mix_of_half_keeps_the_dry_signal_at_full_level();
    a_full_mix_removes_the_dry_signal_and_nothing_comes_before_the_pre_delay();
    the_decay_time_matches_decay_for_every_type();
    every_type_stays_stable_with_every_knob_at_its_maximum();
    a_tail_decays_to_exact_zeros();
    non_finite_and_absurd_params_read_as_safe_values();
    a_non_finite_input_sample_cannot_poison_the_reverb();
    every_type_is_finite_and_in_bounds_at_44_1_48_96_and_192_khz();
    a_type_change_restarts_the_tail_without_a_click();
    after_a_type_change_the_new_type_reverberates();
    a_type_change_reversed_mid_fade_fades_back_in();
    with_the_input_closed_the_dry_passes_untouched_and_nothing_enters();
    closing_the_input_lets_the_tail_ring_out();
    a_closed_reverb_goes_idle_once_its_tail_is_silent_and_wakes_when_opened();
    an_open_reverb_never_goes_idle_in_silence();
    shimmer_adds_the_octave_above();
    bloom_moves_the_energy_later();
    early_reflections_add_energy_in_the_first_40_ms();
    drip_changes_the_spring();
    at_default_settings_the_wet_level_is_close_to_the_input_level();
    reset_clears_everything_and_the_next_params_take_effect_at_once();
}

TEST_MAIN("ReverbProcessor")

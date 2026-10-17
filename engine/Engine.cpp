#include "Engine.h"

#include <algorithm>
#include <utility>

Engine::Engine() {
    staging_.resize(static_cast<size_t>(kMaxModelBytes));

    // Membership is fixed here, once. Phase 3 permutes these entries; it never
    // adds or removes them. The gate runs first, ahead of input gain, so its
    // threshold is in the same units as the input meter that sits beside it
    // (spec 2026-09-22-fixed-noise-gate §2). The NAM stages run before the EQ
    // (spec 2026-09-22-rack-rewire §2): an amp model's gain flattens most of
    // what a pre-EQ does, so the tone stack shapes the finished sound instead.
    // NAM stages draw their k-rate params from the pooled slots, so chaining
    // several models is a change to kNamCount rather than to the layout.
    gate_.enabled = false;
    chain_.add(&gate_, kGateThresholdIndex);
    chain_.add(&inputGain_, kInputGainIndex);
    // The PRE effect: after the input gain, so the input trim also sets how
    // hard it is hit, and before the amp model, like a pedal in front of an
    // amp (spec 2026-09-25-drive-effect §3.1). It starts disabled; the UI
    // enables it when it is dropped into PRE.
    drive_.enabled = false;
    chain_.add(&drive_, kDriveParamIndex);
    for (int32_t i = 0; i < kNamCount; ++i) {
        nam_[i].enabled = false;
        chain_.add(&nam_[i], kSlotBaseIndex + i * kParamsPerSlot);
    }
    // The cab follows the amp model and precedes the EQ, so the tone stack
    // shapes the cabbed sound (spec 2026-09-24-cab-ir §2). It starts disabled,
    // like the gate; with no IR loaded it would pass through anyway.
    cab_.enabled = false;
    chain_.add(&cab_, kCabLevelIndex);
    // The POST effects follow the cab and precede the EQ, so the tone stack
    // shapes them too (spec 2026-09-25-delay-effect §3.1). Chorus, tremolo,
    // delay, reverb by default: modulation before the time effects, so the
    // echoes repeat the chorused, pulsing sound and the reverb tails the lot;
    // setPostOrder() rearranges them (spec 2026-10-01-reverb-effect §3.3,
    // 2026-10-06-tremolo-effect §3.1). All start disabled: the UI enables each
    // one when it is dropped into POST. They must stay adjacent, at
    // kPostEntryIndex.
    chorus_.enabled = false;
    chain_.add(&chorus_, kChorusParamIndex);
    tremolo_.enabled = false;
    chain_.add(&tremolo_, kTremoloParamIndex);
    delay_.enabled = false;
    chain_.add(&delay_, kDelayParamIndex);
    reverb_.enabled = false;
    chain_.add(&reverb_, kReverbParamIndex);
    chain_.add(&eq_, kEqBaseIndex);
    chain_.add(&outputVolume_, kOutputVolumeIndex);
}

void Engine::prepare(double sampleRate, int32_t maxBlockSize) {
    sampleRate_ = sampleRate;
    const int32_t block = maxBlockSize > kMaxBlockSize ? kMaxBlockSize : maxBlockSize;
    chain_.prepare(sampleRate, block);
    chain_.reset();
}

void Engine::reset() {
    chain_.reset();
}

void Engine::process(int32_t numFrames) {
    const int32_t frames = numFrames > kMaxBlockSize ? kMaxBlockSize : numFrames;
    if (frames <= 0) return;
    chain_.process(buffer_, frames, params_);
}

bool Engine::loadNamModel(int32_t slot, int32_t byteLength) {
    if (slot < 0 || slot >= kNamCount) return false;
    return nam_[slot].loadFrom(staging_.data(), byteLength);
}

void Engine::setNamEnabled(int32_t slot, bool enabled) {
    if (slot < 0 || slot >= kNamCount) return;
    nam_[slot].enabled = enabled;
}

void Engine::setStageEnabled(Stage stage, bool enabled) {
    switch (stage) {
        case Stage::Gate:
            // ProcessorChain::process skips a disabled processor entirely, so
            // the gate's envelope/gain/hold freeze while bypassed. Reset it
            // on the false->true transition only, so re-engaging never
            // resumes closed and swallows the first note (fixed-noise-gate
            // §3) — but re-sending true to an already-enabled gate leaves a
            // legitimately closed gate alone. reset() only writes scalars, so
            // this is RT-safe to call here, on the audio thread between
            // render quanta.
            if (enabled && !gate_.enabled) gate_.reset();
            gate_.enabled = enabled;
            return;
        case Stage::Eq:
            eq_.enabled = enabled;
            return;
        case Stage::Cab:
            // A bypassed stage is not run, so its history goes stale. Reset on
            // the false->true transition only, so re-engaging never convolves
            // against old audio (spec 2026-09-24-cab-ir §3). Zeroing the
            // history is RT-safe here, between render quanta.
            if (enabled && !cab_.enabled) cab_.reset();
            cab_.enabled = enabled;
            return;
        case Stage::Delay:
            // As for the cab: a bypassed stage is not run, so its line goes
            // stale. Reset on the false->true transition only, so re-engaging
            // never plays an echo of audio from before it was switched off.
            if (enabled && !delay_.enabled) delay_.reset();
            delay_.enabled = enabled;
            return;
        case Stage::Chorus:
            // As for the delay: reset on the false->true transition only, so
            // re-engaging never plays audio from before it was switched off.
            if (enabled && !chorus_.enabled) chorus_.reset();
            chorus_.enabled = enabled;
            return;
        case Stage::Drive:
            // As for the other effects: reset on the false->true transition
            // only, so re-engaging never rings on from before it was switched off.
            if (enabled && !drive_.enabled) drive_.reset();
            drive_.enabled = enabled;
            return;
        case Stage::Reverb:
            // As for the other effects. With trails on, the UI keeps the stage
            // enabled through a bypass and closes the input instead
            // (setReverbInput), so the tail is not reset when it comes back.
            if (enabled && !reverb_.enabled) reverb_.reset();
            reverb_.enabled = enabled;
            return;
        case Stage::Tremolo:
            // As for the other effects: reset on the false->true transition
            // only, so a tremolo switched on starts at the top of its wave.
            if (enabled && !tremolo_.enabled) tremolo_.reset();
            tremolo_.enabled = enabled;
            return;
    }
    // An id this build does not know — a newer UI against an older engine —
    // changes nothing rather than flipping some other stage.
}

bool Engine::loadCabIr(int32_t length) {
    return cab_.loadIr(length);
}

Processor& Engine::postProcessor(Stage stage) {
    if (stage == Stage::Chorus) return chorus_;
    if (stage == Stage::Delay) return delay_;
    if (stage == Stage::Tremolo) return tremolo_;
    return reverb_;
}

void Engine::setPostOrder(Stage first, Stage second, Stage third, Stage fourth) {
    const std::array<Stage, kPostCount> next = {first, second, third, fourth};
    // Anything but a permutation of the four POST effects (a newer UI, a bad
    // message) changes nothing.
    for (Stage stage : {Stage::Chorus, Stage::Tremolo, Stage::Delay, Stage::Reverb}) {
        if (std::count(next.begin(), next.end(), stage) != 1) return;
    }
    if (next == postOrder_) return;

    const std::array<Stage, kPostCount> before = postOrder_;
    // Selection by swaps: at most three, each moving one entry to its place.
    // Each entry keeps its own parameter offset, so a moved processor still
    // reads its own slice.
    for (int32_t k = 0; k < kPostCount; ++k) {
        if (postOrder_[static_cast<size_t>(k)] == next[static_cast<size_t>(k)]) continue;
        int32_t j = k + 1;
        while (postOrder_[static_cast<size_t>(j)] != next[static_cast<size_t>(k)]) ++j;
        chain_.swapEntries(kPostEntryIndex + k, kPostEntryIndex + j);
        std::swap(postOrder_[static_cast<size_t>(k)], postOrder_[static_cast<size_t>(j)]);
    }
    // Reset whatever now sits somewhere new, so no stale tail plays from a new
    // position; one that kept its place rings on. Clearing only writes
    // scalars and buffers sized at construction: RT-safe here, between quanta.
    for (int32_t k = 0; k < kPostCount; ++k) {
        if (before[static_cast<size_t>(k)] != next[static_cast<size_t>(k)]) postProcessor(next[static_cast<size_t>(k)]).reset();
    }
}

void Engine::setReverbInput(bool open) {
    reverb_.setInputOpen(open);
}

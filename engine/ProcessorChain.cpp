#include "ProcessorChain.h"

#include <cassert>
#include <utility>

void ProcessorChain::add(Processor* processor, int paramOffset) {
    // Asserts catch programmer errors in debug builds.
    // Early returns let release builds degrade gracefully.
    assert(processor != nullptr && "ProcessorChain::add: null processor");
    assert(static_cast<int>(entries_.size()) < kMaxEntries &&
           "ProcessorChain::add: chain is full — raise kMaxEntries");
    if (processor == nullptr) return;
    if (static_cast<int>(entries_.size()) >= kMaxEntries) return;
    entries_.push_back(Entry{processor, paramOffset});
}

void ProcessorChain::prepare(double sampleRate, int32_t maxBlockSize) {
    for (const Entry& entry : entries_) {
        entry.processor->prepare(sampleRate, maxBlockSize);
    }
}

void ProcessorChain::reset() {
    for (const Entry& entry : entries_) {
        entry.processor->reset();
    }
}

void ProcessorChain::process(float* buffer, int32_t numFrames, const float* paramBlock) {
    for (const Entry& entry : entries_) {
        if (!entry.processor->enabled) continue;
        entry.processor->setParams(paramBlock + entry.paramOffset);
        entry.processor->process(buffer, numFrames);
    }
}

bool ProcessorChain::swapEntries(int i, int j) {
    if (i < 0 || j < 0 || i >= size() || j >= size()) return false;
    std::swap(entries_[static_cast<size_t>(i)], entries_[static_cast<size_t>(j)]);
    return true;
}

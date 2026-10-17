// The ONLY file in engine/ that includes Emscripten headers. Everything else
// must stay host-compilable, or the CMake test build breaks.

#include <emscripten/bind.h>
#include <emscripten/emscripten.h>

#include <cstdint>

#include "Engine.h"

namespace {

// One engine for the lifetime of the worklet. Constructed once, from
// createEngine(), before any audio flows, and never freed: the module
// instance's lifetime IS the engine's lifetime, and the browser reclaims the
// whole linear memory when it tears the module down. There is deliberately no
// destroyEngine() — nothing is missing here.
Engine* g_engine = nullptr;

void createEngine() {
    if (g_engine == nullptr) g_engine = new Engine();
}

void prepareEngine(double sampleRate, int32_t maxBlockSize) {
    if (g_engine != nullptr) g_engine->prepare(sampleRate, maxBlockSize);
}

void resetEngine() {
    if (g_engine != nullptr) g_engine->reset();
}

// Processing is in place, so the input and the output are the same block. Both
// accessors exist because the spec names both; they alias deliberately.
uint32_t getInputPtr() {
    return g_engine != nullptr ? static_cast<uint32_t>(reinterpret_cast<uintptr_t>(g_engine->buffer())) : 0u;
}

uint32_t getOutputPtr() { return getInputPtr(); }

uint32_t getParamPtr() {
    return g_engine != nullptr ? static_cast<uint32_t>(reinterpret_cast<uintptr_t>(g_engine->params())) : 0u;
}

int32_t getMaxBlockSize() { return Engine::kMaxBlockSize; }
int32_t getParamCount() { return Engine::kParamCount; }

// The three layout constants Engine.h's static_asserts pin, exported so the
// worklet can compare them against PARAM_INDEX in params.ts at instantiation.
// getParamCount() alone only catches a length mismatch, not a reordering: a
// coordinated edit on both sides could keep the count and every existing test
// green while still misaligning which knob drives which DSP parameter.
int32_t getEqBaseIndex() { return Engine::kEqBaseIndex; }
int32_t getOutputVolumeIndex() { return Engine::kOutputVolumeIndex; }
int32_t getSlotBaseIndex() { return Engine::kSlotBaseIndex; }
int32_t getParamsPerSlot() { return Engine::kParamsPerSlot; }
int32_t getEqLevelIndex() { return Engine::kEqLevelIndex; }
int32_t getGateThresholdIndex() { return Engine::kGateThresholdIndex; }
int32_t getCabLevelIndex() { return Engine::kCabLevelIndex; }

// Where the worklet copies model bytes. Derived once by the worklet, like the
// buffer and param pointers, because ALLOW_MEMORY_GROWTH=0 makes it stable.
uint32_t getModelStagingPtr() {
    return g_engine != nullptr
               ? static_cast<uint32_t>(reinterpret_cast<uintptr_t>(g_engine->modelStaging()))
               : 0u;
}

int32_t getMaxModelBytes() { return Engine::kMaxModelBytes; }
int32_t getNamCount() { return Engine::kNamCount; }

// Where the worklet copies an IR's taps, and how many it may copy. Derived once,
// like every other heap pointer, because ALLOW_MEMORY_GROWTH=0 makes it stable.
uint32_t getIrStagingPtr() {
    return g_engine != nullptr
               ? static_cast<uint32_t>(reinterpret_cast<uintptr_t>(g_engine->cabIrStaging()))
               : 0u;
}

int32_t getMaxIrTaps() { return Engine::kMaxCabTaps; }

bool loadCabIr(int32_t length) {
    return g_engine != nullptr && g_engine->loadCabIr(length);
}

bool loadNamModel(int32_t slot, int32_t byteLength) {
    return g_engine != nullptr && g_engine->loadNamModel(slot, byteLength);
}

void setNamEnabled(int32_t slot, bool enabled) {
    if (g_engine != nullptr) g_engine->setNamEnabled(slot, enabled);
}

// `stage` is an Engine::Stage value. Casting an unknown id is well defined
// (Stage has a fixed underlying type) and Engine::setStageEnabled ignores it.
void setStageEnabled(int32_t stage, bool enabled) {
    if (g_engine != nullptr) g_engine->setStageEnabled(static_cast<Engine::Stage>(stage), enabled);
}

// Engine::Stage values, first to last. Engine::setPostOrder ignores anything
// that is not a permutation of Chorus, Tremolo, Delay and Reverb, so an
// unknown id from a newer UI changes nothing.
void setPostOrder(int32_t first, int32_t second, int32_t third, int32_t fourth) {
    if (g_engine != nullptr) {
        g_engine->setPostOrder(static_cast<Engine::Stage>(first), static_cast<Engine::Stage>(second),
                               static_cast<Engine::Stage>(third), static_cast<Engine::Stage>(fourth));
    }
}

// Trails: closed, an enabled reverb lets its tail ring out and passes the dry.
void setReverbInput(bool open) {
    if (g_engine != nullptr) g_engine->setReverbInput(open);
}

}  // namespace

extern "C" {

// The hot path. Deliberately NOT an embind function: this is called once per
// 128-frame quantum and must be a direct wasm export.
EMSCRIPTEN_KEEPALIVE void engine_process(int32_t numFrames) {
    if (g_engine != nullptr) g_engine->process(numFrames);
}

}  // extern "C"

EMSCRIPTEN_BINDINGS(nam_engine) {
    emscripten::function("createEngine", &createEngine);
    emscripten::function("prepareEngine", &prepareEngine);
    emscripten::function("resetEngine", &resetEngine);
    emscripten::function("getInputPtr", &getInputPtr);
    emscripten::function("getOutputPtr", &getOutputPtr);
    emscripten::function("getParamPtr", &getParamPtr);
    emscripten::function("getMaxBlockSize", &getMaxBlockSize);
    emscripten::function("getParamCount", &getParamCount);
    emscripten::function("getEqBaseIndex", &getEqBaseIndex);
    emscripten::function("getOutputVolumeIndex", &getOutputVolumeIndex);
    emscripten::function("getSlotBaseIndex", &getSlotBaseIndex);
    emscripten::function("getParamsPerSlot", &getParamsPerSlot);
    emscripten::function("getEqLevelIndex", &getEqLevelIndex);
    emscripten::function("getGateThresholdIndex", &getGateThresholdIndex);
    emscripten::function("getCabLevelIndex", &getCabLevelIndex);
    emscripten::function("getIrStagingPtr", &getIrStagingPtr);
    emscripten::function("getMaxIrTaps", &getMaxIrTaps);
    emscripten::function("loadCabIr", &loadCabIr);
    emscripten::function("getModelStagingPtr", &getModelStagingPtr);
    emscripten::function("getMaxModelBytes", &getMaxModelBytes);
    emscripten::function("getNamCount", &getNamCount);
    emscripten::function("loadNamModel", &loadNamModel);
    emscripten::function("setNamEnabled", &setNamEnabled);
    emscripten::function("setStageEnabled", &setStageEnabled);
    emscripten::function("setPostOrder", &setPostOrder);
    emscripten::function("setReverbInput", &setReverbInput);
}

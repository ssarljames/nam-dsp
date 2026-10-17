#pragma once

// Force-included ahead of nlohmann/json.hpp in every translation unit that can
// see it (both the emcc build and the host test build pass `-include` for it).
//
// nlohmann's default JSON_ASSERT is plain assert(). NAM core's loader indexes
// const JSON objects directly, so a .nam file that is valid JSON but lacks an
// expected key trips that assert from inside the library — and assert() aborts
// the whole process. In the browser that process is the audio worklet: one bad
// upload would kill the engine outright. Throwing instead lets
// NamProcessor::loadFrom catch it and reject the model like any other.
//
// It must be identical in every TU, since it changes the bodies of inline
// templates; that is why it is applied build-wide rather than per file.

#include <stdexcept>

#define JSON_ASSERT(x) \
    ((x) ? static_cast<void>(0) : throw std::runtime_error("malformed .nam document: " #x))

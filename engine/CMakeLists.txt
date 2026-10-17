cmake_minimum_required(VERSION 3.16)
project(nam_engine_tests CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

enable_testing()

# The same sources emcc compiles for the browser, built here for the host so the
# DSP maths can be checked analytically. bindings.cpp is deliberately absent:
# it is the only file that includes Emscripten headers.
# NeuralAmpModelerCore, built from the same sources emcc uses. NAM core is
# C++20 and needs Eigen + nlohmann on the include path; NamProcessor.cpp is the
# only file in engine/ that includes it.
set(NAM_DIR ${CMAKE_CURRENT_SOURCE_DIR}/third_party/NeuralAmpModelerCore)
file(GLOB NAM_SOURCES ${NAM_DIR}/NAM/*.cpp ${NAM_DIR}/NAM/wavenet/*.cpp)

# OBJECT, not STATIC. Each NAM architecture registers its parser from a static
# initializer, and nothing references those translation units directly — so a
# static archive lets the linker drop them and every load fails with "No config
# parser registered for architecture". Object files are always linked in.
add_library(nam_core OBJECT ${NAM_SOURCES})
target_include_directories(nam_core SYSTEM PUBLIC
    ${NAM_DIR}
    ${NAM_DIR}/Dependencies/eigen
    ${NAM_DIR}/Dependencies/nlohmann)
target_compile_features(nam_core PUBLIC cxx_std_20)
target_compile_definitions(nam_core PUBLIC NAM_SAMPLE_FLOAT NAM_ENABLE_A2_FAST EIGEN_DONT_PARALLELIZE)
# See nam_json_config.h: a malformed .nam must throw, not assert-and-abort.
target_compile_options(nam_core PUBLIC -include ${CMAKE_CURRENT_SOURCE_DIR}/nam_json_config.h)
# The throwing JSON_ASSERT also expands inside nlohmann's assert_invariant(),
# which is noexcept, so GCC warns the throw "will always call terminate". Those
# checks guard nlohmann's internal invariants (an object value has a non-null
# pointer, and so on) and only fire on memory corruption, where terminating is
# what the default assert() did anyway. The input-driven check — indexing a
# const object by a missing key — is not noexcept, and does throw and get
# caught; test_nam_processor pins that.
target_compile_options(nam_core PUBLIC -Wno-terminate)

add_library(nam_engine INTERFACE)
target_include_directories(nam_engine INTERFACE ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(nam_engine INTERFACE nam_core)

function(nam_add_test name)
    add_executable(test_${name} tests/test_${name}.cpp ${ARGN})
    target_link_libraries(test_${name} PRIVATE nam_engine nam_core)
    target_include_directories(test_${name} PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    target_compile_options(test_${name} PRIVATE -Wall -Wextra -Wpedantic -O2)
    # Real .nam documents for tests that need a model the library will accept.
    target_compile_definitions(test_${name} PRIVATE
        NAM_EXAMPLE_MODELS_DIR="${NAM_DIR}/example_models")
    add_test(NAME ${name} COMMAND test_${name})
endfunction()

nam_add_test(smoothed_value)
nam_add_test(processor_chain ProcessorChain.cpp)
nam_add_test(gain_processor GainProcessor.cpp)
nam_add_test(eq_processor EqProcessor.cpp)
nam_add_test(gate_processor GateProcessor.cpp)
nam_add_test(cab_processor CabProcessor.cpp)
nam_add_test(delay_processor DelayProcessor.cpp)
nam_add_test(chorus_processor ChorusProcessor.cpp)
nam_add_test(drive_processor DriveProcessor.cpp)
nam_add_test(reverb_processor ReverbProcessor.cpp)
nam_add_test(tremolo_processor TremoloProcessor.cpp)
nam_add_test(nam_processor NamProcessor.cpp)
nam_add_test(engine Engine.cpp ProcessorChain.cpp GateProcessor.cpp CabProcessor.cpp DelayProcessor.cpp ChorusProcessor.cpp DriveProcessor.cpp ReverbProcessor.cpp TremoloProcessor.cpp GainProcessor.cpp EqProcessor.cpp NamProcessor.cpp)

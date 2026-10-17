#pragma once

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>

namespace testutil {

inline int failures = 0;

inline void report(const char* file, int line, const std::string& msg) {
    std::fprintf(stderr, "FAIL %s:%d  %s\n", file, line, msg.c_str());
    ++failures;
}

inline int finish(const char* name) {
    if (failures == 0) {
        std::printf("PASS %s\n", name);
        return 0;
    }
    std::fprintf(stderr, "%d failure(s) in %s\n", failures, name);
    return 1;
}

}  // namespace testutil

#define CHECK(cond)                                                       \
    do {                                                                  \
        if (!(cond)) testutil::report(__FILE__, __LINE__, "CHECK(" #cond ")"); \
    } while (0)

#define CHECK_CLOSE(a, b, tol)                                            \
    do {                                                                  \
        const double _a = (a), _b = (b);                                  \
        if (!(std::fabs(_a - _b) <= (tol)))                               \
            testutil::report(__FILE__, __LINE__,                          \
                             std::string(#a " != " #b " (") +             \
                                 std::to_string(_a) + " vs " +            \
                                 std::to_string(_b) + ")");               \
    } while (0)

#define CHECK_FINITE(x)                                                   \
    do {                                                                  \
        const double _x = (x);                                            \
        if (!std::isfinite(_x))                                           \
            testutil::report(__FILE__, __LINE__, "not finite: " #x);      \
    } while (0)

#define TEST_MAIN(name)          \
    int main() {                 \
        run_tests();             \
        return testutil::finish(name); \
    }

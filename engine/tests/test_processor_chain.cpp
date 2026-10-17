#include "ProcessorChain.h"
#include "test_util.h"

#include <string>
#include <vector>

namespace {

// Records what it was asked to do, so ordering and dispatch can be asserted.
class FakeProcessor : public Processor {
public:
    FakeProcessor(const char* tag, std::vector<std::string>* log) : tag_(tag), log_(log) {}

    void prepare(double sampleRate, int32_t maxBlockSize) override {
        preparedRate = sampleRate;
        preparedBlock = maxBlockSize;
    }

    void reset() override { ++resetCount; }

    void setParams(const float* params) override { firstParam = params[0]; }

    void process(float* buffer, int32_t numFrames) override {
        log_->push_back(tag_);
        lastNumFrames = numFrames;
        for (int32_t i = 0; i < numFrames; ++i) buffer[i] += 1.0f;
    }

    double preparedRate = 0.0;
    int32_t preparedBlock = 0;
    int resetCount = 0;
    float firstParam = -999.0f;
    int32_t lastNumFrames = 0;

private:
    std::string tag_;
    std::vector<std::string>* log_;
};

}  // namespace

static void runs_enabled_processors_in_insertion_order() {
    std::vector<std::string> log;
    FakeProcessor a("a", &log), b("b", &log), c("c", &log);

    ProcessorChain chain;
    chain.add(&a, 0);
    chain.add(&b, 1);
    chain.add(&c, 2);

    float params[4] = {10.0f, 20.0f, 30.0f, 40.0f};
    float buffer[8] = {};
    chain.process(buffer, 8, params);

    CHECK(log.size() == 3);
    CHECK(log[0] == "a");
    CHECK(log[1] == "b");
    CHECK(log[2] == "c");
    CHECK_CLOSE(buffer[0], 3.0f, 1e-6);
}

static void dispatches_the_right_param_slice_to_each_entry() {
    std::vector<std::string> log;
    FakeProcessor a("a", &log), b("b", &log);

    ProcessorChain chain;
    chain.add(&a, 0);
    chain.add(&b, 3);

    float params[6] = {1.0f, 2.0f, 3.0f, 4.0f, 5.0f, 6.0f};
    float buffer[4] = {};
    chain.process(buffer, 4, params);

    CHECK_CLOSE(a.firstParam, 1.0f, 1e-6);
    CHECK_CLOSE(b.firstParam, 4.0f, 1e-6);
}

static void skips_disabled_processors_entirely() {
    std::vector<std::string> log;
    FakeProcessor a("a", &log), b("b", &log);
    b.enabled = false;

    ProcessorChain chain;
    chain.add(&a, 0);
    chain.add(&b, 0);

    float params[1] = {7.0f};
    float buffer[4] = {};
    chain.process(buffer, 4, params);

    CHECK(log.size() == 1);
    CHECK(log[0] == "a");
    // A disabled processor is not even told about its parameters.
    CHECK(b.firstParam == -999.0f);
    CHECK_CLOSE(buffer[0], 1.0f, 1e-6);
}

static void forwards_prepare_and_reset_to_every_entry() {
    std::vector<std::string> log;
    FakeProcessor a("a", &log), b("b", &log);
    b.enabled = false;

    ProcessorChain chain;
    chain.add(&a, 0);
    chain.add(&b, 0);

    chain.prepare(44100.0, 128);
    chain.reset();

    CHECK_CLOSE(a.preparedRate, 44100.0, 1e-9);
    CHECK(a.preparedBlock == 128);
    CHECK(a.resetCount == 1);
    // Disabled entries are still prepared and reset — they can be re-enabled
    // mid-session and must not come back with stale state.
    CHECK_CLOSE(b.preparedRate, 44100.0, 1e-9);
    CHECK(b.resetCount == 1);
}

static void passes_the_frame_count_through_unchanged() {
    std::vector<std::string> log;
    FakeProcessor a("a", &log);

    ProcessorChain chain;
    chain.add(&a, 0);

    float params[1] = {0.0f};
    float buffer[128] = {};
    chain.process(buffer, 128, params);

    CHECK(a.lastNumFrames == 128);
}

static void swap_entries_swaps_two_entries_with_their_offsets() {
    std::vector<std::string> log;
    FakeProcessor a("a", &log), b("b", &log), c("c", &log);

    ProcessorChain chain;
    chain.add(&a, 0);
    chain.add(&b, 1);
    chain.add(&c, 3);

    CHECK(chain.swapEntries(0, 2));
    CHECK(chain.at(0) == &c);
    CHECK(chain.paramOffsetAt(0) == 3);
    CHECK(chain.at(1) == &b);
    CHECK(chain.paramOffsetAt(1) == 1);
    CHECK(chain.at(2) == &a);
    CHECK(chain.paramOffsetAt(2) == 0);

    float params[4] = {10.0f, 20.0f, 30.0f, 40.0f};
    float buffer[4] = {};
    chain.process(buffer, 4, params);

    CHECK(log.size() == 3);
    CHECK(log[0] == "c");
    CHECK(log[1] == "b");
    CHECK(log[2] == "a");
    // Each processor keeps its own slice, wherever it now runs.
    CHECK_CLOSE(c.firstParam, 40.0f, 1e-6);
    CHECK_CLOSE(a.firstParam, 10.0f, 1e-6);
    // Swapping only moves entries; resetting them is the caller's job.
    CHECK(a.resetCount == 0);
    CHECK(c.resetCount == 0);
}

static void swap_entries_rejects_a_bad_index() {
    std::vector<std::string> log;
    FakeProcessor a("a", &log), b("b", &log);

    ProcessorChain chain;
    chain.add(&a, 0);
    chain.add(&b, 1);

    CHECK(!chain.swapEntries(-1, 0));
    CHECK(!chain.swapEntries(0, 2));
    CHECK(!chain.swapEntries(5, 1));
    CHECK(chain.at(0) == &a);
    CHECK(chain.at(1) == &b);

    // An entry swapped with itself is allowed and changes nothing.
    CHECK(chain.swapEntries(1, 1));
    CHECK(chain.at(0) == &a);
    CHECK(chain.at(1) == &b);
}

static void run_tests() {
    runs_enabled_processors_in_insertion_order();
    dispatches_the_right_param_slice_to_each_entry();
    skips_disabled_processors_entirely();
    forwards_prepare_and_reset_to_every_entry();
    passes_the_frame_count_through_unchanged();
    swap_entries_swaps_two_entries_with_their_offsets();
    swap_entries_rejects_a_bad_index();
}

TEST_MAIN("ProcessorChain")

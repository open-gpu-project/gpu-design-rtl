#include "tracer.h"

class MyRecorder : public framework::RecorderBase {
public:
   void record_value_change(unsigned, int const& value) {
   }
};

static_assert(framework::RecordableTrait<MyRecorder, int>,
              "MyRecorder must satisfy the RecordableTrait for int");

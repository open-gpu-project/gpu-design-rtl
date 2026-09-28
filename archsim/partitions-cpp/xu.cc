#include "xu.h"

using namespace partitions;

void XU::on_evaluate() {
   m_pcout.assign(m_pcin.value(), m_pcin.tag());
}

void XU::on_tick() {
   
}

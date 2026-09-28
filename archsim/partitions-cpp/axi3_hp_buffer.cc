#include "axi3_hp_buffer.h"

#include <cstdint>

#include "framework-cpp/axi3.h"

using namespace partitions;
namespace axi3 = framework::axi3;

Axi3HpBuffer::Axi3HpBuffer(EntityConfig config)
      : framework::Entity{config},
        m_axi_interface(config.add_child<AxiInterfaceHolder>("").second),
        m_r_channel_queue{} {}

void Axi3HpBuffer::on_evaluate() {
   auto [ar, aw, w, r] = m_axi_interface.get<axi3::MasterInterface>();
   if (ar.valid()) evaluate_ar(ar.read());
}

void Axi3HpBuffer::on_tick() {
   // ...
}

void Axi3HpBuffer::evaluate_ar(ArAndTag const& ar_and_tag) {
   constexpr uint32_t data_bytes = decltype(axi3::RChannelData::rdata){}.size() / 8;
   auto [ar, tag] = ar_and_tag;
   auto const start_addr = static_cast<uint32_t>(ar.araddr.to_ulong());
   auto const burst_len = static_cast<uint32_t>(ar.arlen.to_ulong()) + 1;
   auto const beat_bytes = uint32_t{1} << ar.arsize.to_ulong();
   auto const wrap_bytes = beat_bytes * burst_len;
   auto const wrap_boundary = start_addr / wrap_bytes * wrap_bytes;
   auto addr = start_addr;
   for (uint32_t beat = 0; beat < burst_len; ++beat) {
      // Only the first beat of an unaligned burst (or every beat of an
      // unaligned FIXED burst) is narrower than the transfer size.
      auto const beat_aligned_addr = addr / beat_bytes * beat_bytes;
      auto const lane_base = addr / data_bytes * data_bytes;
      auto const lower_lane = addr - lane_base;
      auto const upper_lane = beat_aligned_addr + beat_bytes - 1 - lane_base;
      auto r = axi3::RChannelData{
            .rid = ar.arid,
            .rdata = read_data(lane_base),
            .rstrb = 0,
            .rlast = beat == burst_len - 1,
      };
      for (auto lane = lower_lane; lane <= upper_lane; ++lane) {
         r.rstrb.set(lane);
      }
      m_r_channel_queue.push(RAndTag{r, tag});
      if (ar.arburst != axi3::BurstType::Fixed) {
         addr = beat_aligned_addr + beat_bytes;
         if (ar.arburst == axi3::BurstType::Wrap && addr >= wrap_boundary + wrap_bytes) {
            addr = wrap_boundary;
         }
      }
   }
}

uint32_t Axi3HpBuffer::read_data(uint32_t) const {
   return 0; // Placeholder as the buffer has no backing storage yet
}

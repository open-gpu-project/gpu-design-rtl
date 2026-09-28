#include "axi3.h"

#include <magic_enum/magic_enum.hpp>
#include <string_view>

using namespace framework::axi3;

namespace {
   // Width of the R data bus in bytes, i.e. the number of strobe lanes
   constexpr uint32_t kDataBusBytes = decltype(RChannelData::rdata){}.size() / 8;
   // Bursts must not cross a 4KB address boundary
   constexpr uint64_t kBurstBoundaryBytes = 4096;
} // namespace

template <>
void ChannelSource<ArChannelData>::check_value_if_valid() const {
   auto maybe_ar = peek_data();
   if (!maybe_ar.has_value()) return;
   auto ar = maybe_ar.value();
   auto const start_addr = static_cast<uint32_t>(ar.araddr.to_ulong());
   auto const burst_len = static_cast<uint32_t>(ar.arlen.to_ulong()) + 1;
   auto const beat_bytes = uint32_t{1} << ar.arsize.to_ulong();
   auto const wrap_bytes = beat_bytes * burst_len;
   std::string_view entity_name = m_fifo.config().name;

   if (beat_bytes > kDataBusBytes) {
      throw framework::GenericSimulationException(
            "ARSIZE exceeds the data bus width",
            std::pair{"entity", entity_name},
            std::pair{"beat_bytes", static_cast<int>(beat_bytes)},
            std::pair{"bus_bytes", static_cast<int>(kDataBusBytes)});
   }
   switch (ar.arburst) {
      case BurstType::Fixed:
         break;
      case BurstType::Incr: {
         auto const aligned_addr = start_addr / beat_bytes * beat_bytes;
         auto const last_byte = uint64_t{aligned_addr} + wrap_bytes - 1;
         if (start_addr / kBurstBoundaryBytes != last_byte / kBurstBoundaryBytes) {
            throw framework::GenericSimulationException(
                  "INCR burst crosses a 4KB boundary",
                  std::pair{"entity", entity_name},
                  std::pair{"araddr", static_cast<int64_t>(start_addr)},
                  std::pair{"burst_len", static_cast<int>(burst_len)});
         }
         break;
      }
      case BurstType::Wrap:
         if (start_addr % beat_bytes != 0 ||
             (burst_len != 2 && burst_len != 4 && burst_len != 8 && burst_len != 16)) {
            throw framework::GenericSimulationException(
                  "Illegal WRAP burst",
                  std::pair{"entity", entity_name},
                  std::pair{"araddr", static_cast<int64_t>(start_addr)},
                  std::pair{"burst_len", static_cast<int>(burst_len)});
         }
         break;
      default:
         throw framework::GenericSimulationException(
               "Reserved ARBURST encoding",
               std::pair{"entity", entity_name},
               std::pair{"arburst", magic_enum::enum_name(ar.arburst)});
   }
}

template <>
void ChannelSource<RChannelData>::check_value_if_valid() const {
   // Pass
}

template <>
void ChannelSource<AwChannelData>::check_value_if_valid() const {
   // Pass
}

template <>
void ChannelSource<WChannelData>::check_value_if_valid() const {
   // Pass
}

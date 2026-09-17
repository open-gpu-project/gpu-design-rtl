/**
 * XBN - XU Bus Network
 */

#pragma once

#include <stdint.h>

namespace partitions::xbn {

   struct xu_id_t {
      uint8_t use_id; // [0, 2] (2 bits)
      uint8_t usc_id; // [0, 2] (2 bits)
      uint8_t xu_id;  // [0, 4] (3 bits)
   };

   struct xu_reg_addr_t {
      uint16_t value; // 10 bits
   };

   enum class UpstreamCommand {
      NoOp,
      WriteToRegister
   };

   struct UpstreamPacket {
      xu_id_t target_xu;
      UpstreamCommand command;
      xu_reg_addr_t reg_addr;
   };

   enum class DownstreamCommand {
      NoOp,
   };

   struct DownstreamPacket {
      xu_id_t source_xu;
      DownstreamCommand command;
   };

} // namespace partitions::xbn

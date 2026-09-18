#pragma once

#include <bitset>
#include <type_traits>

#include "fifo.h"
#include "simulation.h"

namespace framework::axi3 {

   /**
    * All non-handshake signals for the AR channel
    */
   struct ArChannelData {
      std::bitset<6> arid;
      std::bitset<32> araddr;
      std::bitset<8> arlen;
      std::bitset<3> arsize;
      std::bitset<2> arburst;
   };

   /**
    * All non-handshake signals for the R channel
    */
   struct RChannelData {
      std::bitset<6> rid;
      std::bitset<32> rdata;
      std::bitset<4> rstrb;
      std::bitset<1> rlast;
   };

   /**
    * All non-handshake signals for the AW channel
    */
   struct AwChannelData {
      std::bitset<6> awid;
      std::bitset<32> awaddr;
      std::bitset<8> awlen;
      std::bitset<3> awsize;
      std::bitset<2> awburst;
   };

   /**
    * All non-handshake signals for the W channel
    */
   struct WChannelData {
      std::bitset<6> wid;
      std::bitset<32> wdata;
      std::bitset<4> wstrb;
      std::bitset<1> wlast;
   };

   /**
    * Concept constraining T to be one of the struct types above.
    */
   template <typename T>
   concept ChannelData = std::is_same_v<T, ArChannelData> || std::is_same_v<T, RChannelData> ||
                         std::is_same_v<T, AwChannelData> || std::is_same_v<T, WChannelData>;

   /**
    * AXI3 Channel Entity, basically a wrapper around a 2-deep Fifo. Cannot
    * be interacted unless split into its Source and Sink views respectively.
    */
   template <ChannelData T>
   struct Channel;

   /**
    * Source view of Channel<T>, required to interact with the channel.
    */
   template <ChannelData T>
   struct ChannelSource;

   /**
    * Sink view of Channel<T>, required to interact with the channel.
    */
   template <ChannelData T>
   struct ChannelSink;

   template <ChannelData T>
   struct ChannelSource {
   public:
      bool ready() const { return m_fifo.can_write(); }
      void write(T data) { m_fifo.write(data); }

   private:
      friend class Channel<T>;
      ChannelSource(Fifo<T, 2>& fifo) : m_fifo{fifo} {}
      Fifo<T, 2>& m_fifo;
   };

   template <ChannelData T>
   struct ChannelSink {
   public:
      bool valid() const { return m_fifo.can_read(); }
      T read() { return m_fifo.read(); }

   private:
      friend class Channel<T>;
      ChannelSink(Fifo<T, 2>& fifo) : m_fifo{fifo} {}
      Fifo<T, 2>& m_fifo;
   };

   template <ChannelData T>
   struct Channel : Entity {
   public:
      std::tuple<ChannelSource<T>, ChannelSink<T>> split() {
         return {ChannelSource<T>(m_fifo), ChannelSink<T>(m_fifo)};
      }

   protected:
      void on_evaluate(Simulation const& sim) override { m_fifo.on_evaluate(sim); }
      void on_tick(Simulation const& sim) override { m_fifo.on_tick(sim); }

   private:
      Fifo<T, 2> m_fifo{};
   };

   /**
    * Type aliases for the channel source and sink structs.
    */

   using ArChannel = Channel<ArChannelData>;
   using ArChannelSource = ChannelSource<ArChannelData>;
   using ArChannelSink = ChannelSink<ArChannelData>;
   using RChannel = Channel<RChannelData>;
   using RChannelSource = ChannelSource<RChannelData>;
   using RChannelSink = ChannelSink<RChannelData>;
   using AwChannel = Channel<AwChannelData>;
   using AwChannelSource = ChannelSource<AwChannelData>;
   using AwChannelSink = ChannelSink<AwChannelData>;
   using WChannel = Channel<WChannelData>;
   using WChannelSource = ChannelSource<WChannelData>;
   using WChannelSink = ChannelSink<WChannelData>;

} // namespace framework::axi3

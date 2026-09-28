/**
 * This file contains the unit tests for fabric.cc/h
 * - address routing (SPLIT[0..2], decoding ar/awaddr against the TCM window)
 * - id routing (SPLIT[3..4], decoding rid through AridToCategory)
 * - arbitration (ARB[0], ARB[1]) and backpressure, i.e. no beat is ever lost
 *
 * Every interface is mocked by the channel on its far end: nothing is backed
 * by a memory, so a response only exists because the test injected it.
 */

#include <catch2/catch_test_macros.hpp>
#include <cstdint>
#include <optional>
#include <string_view>
#include <utility>

#include "framework-cpp/axi3.h"
#include "framework-cpp/simulation.h"
#include "partitions-cpp/fabric.h"

namespace {
   using namespace framework;
   using namespace framework::axi3;
   using partitions::Fabric;

   /// @brief The TCM decode window used by every test. Half-open: [base, limit).
   constexpr uint32_t kTcmBase = 0x8000'0000;
   constexpr uint32_t kTcmLimit = 0x8001'0000;
   /// @brief An address inside the window, so it decodes to TCM_Slave.
   constexpr uint32_t kTcmAddr = 0x8000'0100;
   /// @brief An address outside the window, so it decodes to AXI_HP.
   constexpr uint32_t kHpAddr = 0x1000'0000;

   /**
    * rid encodings, as decoded by `partitions::AridToCategory`: bits [5:4]
    * select the category and bits [3:0] disambiguate the 0b11 prefix.
    */
   constexpr uint8_t kRidUse0 = 0b00'0001;
   constexpr uint8_t kRidUse1 = 0b01'0010;
   constexpr uint8_t kRidUse2 = 0b10'0011;
   constexpr uint8_t kRidTdsuIfetch = 0b11'0000;
   constexpr uint8_t kRidTcmFill = 0b11'0001;
   constexpr uint8_t kRidReserved = 0b11'0010;

   /// @brief One payload popped off a probed channel, with the tag it carried.
   template <ChannelData T>
   struct Beat {
      T data;
      tag_t tag;
   };

   template <ChannelData T>
   using Maybe = std::optional<Beat<T>>;

   /// Stimulus builders. Only the fields the fabric routes on really matter;
   /// the rest are filled in so a beat looks like a plausible single-beat burst.
   ArChannelData ar(uint8_t id, uint32_t addr) { return {id, addr, 0, 0b010, BurstType::Incr}; }
   AwChannelData aw(uint8_t id, uint32_t addr) { return {id, addr, 0, 0b010, BurstType::Incr}; }
   WChannelData wr(uint8_t id, uint32_t data) { return {id, data, 0b1111, 1}; }
   RChannelData rd(uint8_t id, uint32_t data) { return {id, data, 0b1111, 1}; }

   /// @brief Everything the fabric delivered to its outputs during one cycle.
   struct Observed {
      Maybe<ArChannelData> axi_hp_ar{};
      Maybe<AwChannelData> axi_hp_aw{};
      Maybe<WChannelData> axi_hp_w{};
      Maybe<ArChannelData> tcm_slave_ar{};
      Maybe<AwChannelData> tcm_slave_aw{};
      Maybe<WChannelData> tcm_slave_w{};
      Maybe<RChannelData> upq_r{};
      Maybe<RChannelData> tdsu_r{};
      Maybe<RChannelData> tcm_master_r{};
   };

   // FIXME(claude): Deprecate this
   template <typename T>
   T view(AxiInterfaceHolder& port) {
      return std::get<T>(port.get<T>());
   }

   /**
    * DUT wrapper: owns one `AxiInterfaceHolder` per fabric port, plus the
    * fabric itself. A holder owns that port's four channels and hands out the
    * two complementary sets of views -- the fabric takes one side, the test
    * plays whatever is on the other. Which side each end is falls out of the
    * view's type: a `*ChannelSink` here is something the test drives, a
    * `*ChannelSource` something it probes.
    *
    * The backpressure tests also ask a holder for the fabric's *own* view of a
    * channel, to assert that end is full. Nothing stops them: a holder hands
    * out views on request and never tracks who already has one.
    */
   class FabricDut : public Entity {
   public:
      FabricDut(EntityConfig config, std::pair<uint32_t, uint32_t> tcm_range)
            : Entity{config},
              axi_hp{add_port("axi_hp")},
              tdsu{add_port("tdsu")},
              upq{add_port("upq")},
              tcm_master{add_port("tcm_master")},
              tcm_slave{add_port("tcm_slave")},
              dpq_arb{add_port("dpq_arb")},
              fabric{add_fabric(tcm_range)},
              axi_hp_r{axi_hp.view<RChannelSink>()},
              tdsu_ar{view<ArChannelSink>(tdsu)},
              tcm_slave_r{view<RChannelSink>(tcm_slave)},
              dpq_arb_ar{view<ArChannelSink>(dpq_arb)},
              dpq_arb_aw{view<AwChannelSink>(dpq_arb)},
              dpq_arb_w{view<WChannelSink>(dpq_arb)} {}

      /**
       * Advances one cycle, then drains every fabric-driven output channel and
       * reports what came out. Draining keeps a probed port from backpressuring
       * the fabric, which is what a test wants unless it is testing exactly that.
       */
      Observed step() {
         config().simulation.run(1, true);
         return Observed{
               .axi_hp_ar = take<ArChannelData>(axi_hp),
               .axi_hp_aw = take<AwChannelData>(axi_hp),
               .axi_hp_w = take<WChannelData>(axi_hp),
               .tcm_slave_ar = take<ArChannelData>(tcm_slave),
               .tcm_slave_aw = take<AwChannelData>(tcm_slave),
               .tcm_slave_w = take<WChannelData>(tcm_slave),
               .upq_r = take<RChannelData>(upq),
               .tdsu_r = take<RChannelData>(tdsu),
               .tcm_master_r = take<RChannelData>(tcm_master),
         };
      }

      /**
       * Advances the two cycles a freshly driven stimulus needs to reach a
       * fabric output: one for its own channel to latch it, one for the fabric
       * to forward it. Returns what came out on the second cycle.
       */
      Observed settle() {
         step();
         return step();
      }

      /// @brief Advances one cycle without draining, so outputs backpressure.
      void step_no_drain() { config().simulation.run(1, true); }

      // One port per fabric interface. Public so a backpressure test can reach
      // for the fabric's own end of a channel and assert that it is full.
      AxiInterfaceHolder& axi_hp;
      AxiInterfaceHolder& tdsu;
      AxiInterfaceHolder& upq;
      AxiInterfaceHolder& tcm_master;
      AxiInterfaceHolder& tcm_slave;
      AxiInterfaceHolder& dpq_arb;
      Fabric& fabric;

      // The ends the test drives. Everything it only ever probes is drained by
      // `step()` instead, so it needs no member of its own.
      RChannelSink axi_hp_r;
      ArChannelSink tdsu_ar;
      RChannelSink tcm_slave_r;
      ArChannelSink dpq_arb_ar;
      AwChannelSink dpq_arb_aw;
      WChannelSink dpq_arb_w;

   private:
      AxiInterfaceHolder& add_port(std::string_view name) {
         return add_child<AxiInterfaceHolder>(name).second;
      }

      template <ChannelData T>
      Maybe<T> take(AxiInterfaceHolder& port) {
         auto source = view<ChannelSource<T>>(port);
         if (!source.valid()) return std::nullopt;
         auto [data, tag] = source.read();
         return Beat<T>{data, tag};
      }

      Fabric& add_fabric(std::pair<uint32_t, uint32_t> tcm_range) {
         return add_child<Fabric>(
                      "fabric", axi_hp, tdsu, upq, tcm_master, tcm_slave, dpq_arb, tcm_range)
               .second;
      }
   };

   /// @brief A simulation holding a single fabric DUT, rebuilt for each SECTION.
   struct Harness {
      Simulation sim{};
      clock_id_t clk = sim.add_clock("clk");
      FabricDut& dut =
            sim.add_entity<FabricDut>("dut", clk, std::nullopt, std::pair{kTcmBase, kTcmLimit})
                  .second;
   };
} // namespace

TEST_CASE("fabric: AR routes by address") {
   Harness h{};
   auto& dut = h.dut;

   SECTION("an address inside the TCM window reaches TCM_Slave") {
      dut.dpq_arb_ar.write(ar(kRidUse0, kTcmAddr), 11);

      auto obs = dut.settle();

      REQUIRE(obs.tcm_slave_ar.has_value());
      REQUIRE(obs.tcm_slave_ar->data.araddr.to_ulong() == kTcmAddr);
      REQUIRE(obs.tcm_slave_ar->data.arid.to_ulong() == kRidUse0);
      REQUIRE(obs.tcm_slave_ar->tag == 11);
      REQUIRE_FALSE(obs.axi_hp_ar.has_value());
   }

   SECTION("an address outside the TCM window reaches AXI_HP") {
      dut.dpq_arb_ar.write(ar(kRidUse1, kHpAddr), 12);

      auto obs = dut.settle();

      REQUIRE(obs.axi_hp_ar.has_value());
      REQUIRE(obs.axi_hp_ar->data.araddr.to_ulong() == kHpAddr);
      REQUIRE(obs.axi_hp_ar->data.arid.to_ulong() == kRidUse1);
      REQUIRE(obs.axi_hp_ar->tag == 12);
      REQUIRE_FALSE(obs.tcm_slave_ar.has_value());
   }

   SECTION("the window is half-open, so its base decodes to TCM_Slave") {
      dut.dpq_arb_ar.write(ar(kRidUse0, kTcmBase), 13);

      auto obs = dut.settle();

      REQUIRE(obs.tcm_slave_ar.has_value());
      REQUIRE_FALSE(obs.axi_hp_ar.has_value());
   }

   SECTION("...and its limit decodes to AXI_HP") {
      dut.dpq_arb_ar.write(ar(kRidUse0, kTcmLimit), 14);

      auto obs = dut.settle();

      REQUIRE(obs.axi_hp_ar.has_value());
      REQUIRE_FALSE(obs.tcm_slave_ar.has_value());
   }
}

TEST_CASE("fabric: AW and W route together by address") {
   Harness h{};
   auto& dut = h.dut;

   // SPLIT[2] decodes W using AW's address and requires both to be valid in
   // the same cycle, so the two are always driven together.
   SECTION("an address inside the TCM window reaches TCM_Slave") {
      dut.dpq_arb_aw.write(aw(kRidUse0, kTcmAddr), 21);
      dut.dpq_arb_w.write(wr(kRidUse0, 0xC0FF'EE00), 22);

      auto obs = dut.settle();

      REQUIRE(obs.tcm_slave_aw.has_value());
      REQUIRE(obs.tcm_slave_aw->data.awaddr.to_ulong() == kTcmAddr);
      REQUIRE(obs.tcm_slave_aw->tag == 21);
      REQUIRE(obs.tcm_slave_w.has_value());
      REQUIRE(obs.tcm_slave_w->data.wdata.to_ulong() == 0xC0FF'EE00u);
      REQUIRE(obs.tcm_slave_w->tag == 22);

      REQUIRE_FALSE(obs.axi_hp_aw.has_value());
      REQUIRE_FALSE(obs.axi_hp_w.has_value());
   }

   SECTION("an address outside the TCM window reaches AXI_HP") {
      dut.dpq_arb_aw.write(aw(kRidUse1, kHpAddr), 23);
      dut.dpq_arb_w.write(wr(kRidUse1, 0x1234'5678), 24);

      auto obs = dut.settle();

      REQUIRE(obs.axi_hp_aw.has_value());
      REQUIRE(obs.axi_hp_aw->data.awaddr.to_ulong() == kHpAddr);
      REQUIRE(obs.axi_hp_aw->tag == 23);
      REQUIRE(obs.axi_hp_w.has_value());
      REQUIRE(obs.axi_hp_w->data.wdata.to_ulong() == 0x1234'5678u);
      REQUIRE(obs.axi_hp_w->tag == 24);

      REQUIRE_FALSE(obs.tcm_slave_aw.has_value());
      REQUIRE_FALSE(obs.tcm_slave_w.has_value());
   }
}

TEST_CASE("fabric: R responses route by rid") {
   Harness h{};
   auto& dut = h.dut;

   SECTION("a TDSU ifetch id reaches TDSU") {
      dut.axi_hp_r.write(rd(kRidTdsuIfetch, 0xAAAA'0000), 31);

      auto obs = dut.settle();

      REQUIRE(obs.tdsu_r.has_value());
      REQUIRE(obs.tdsu_r->data.rid.to_ulong() == kRidTdsuIfetch);
      REQUIRE(obs.tdsu_r->data.rdata.to_ulong() == 0xAAAA'0000u);
      REQUIRE(obs.tdsu_r->tag == 31);
      REQUIRE_FALSE(obs.tcm_master_r.has_value());
      REQUIRE_FALSE(obs.upq_r.has_value());
   }

   SECTION("a TCM fill id reaches TCM_Master") {
      dut.axi_hp_r.write(rd(kRidTcmFill, 0xBBBB'0000), 32);

      auto obs = dut.settle();

      REQUIRE(obs.tcm_master_r.has_value());
      REQUIRE(obs.tcm_master_r->data.rid.to_ulong() == kRidTcmFill);
      REQUIRE(obs.tcm_master_r->data.rdata.to_ulong() == 0xBBBB'0000u);
      REQUIRE(obs.tcm_master_r->tag == 32);
      REQUIRE_FALSE(obs.tdsu_r.has_value());
      REQUIRE_FALSE(obs.upq_r.has_value());
   }

   SECTION("every XU id reaches UPQ") {
      tag_t tag = 33;
      for (uint8_t rid : {kRidUse0, kRidUse1, kRidUse2}) {
         INFO("rid = " << static_cast<unsigned>(rid));
         dut.axi_hp_r.write(rd(rid, 0xCCCC'0000), tag);

         auto obs = dut.settle();

         REQUIRE(obs.upq_r.has_value());
         REQUIRE(obs.upq_r->data.rid.to_ulong() == rid);
         REQUIRE(obs.upq_r->tag == tag);
         REQUIRE_FALSE(obs.tdsu_r.has_value());
         REQUIRE_FALSE(obs.tcm_master_r.has_value());
         tag++;
      }
   }

   SECTION("a reserved id falls through to UPQ") {
      // SPLIT[3] sends anything that is not a TCM fill or an ifetch to ARB[1],
      // so a reserved encoding is delivered rather than dropped.
      dut.axi_hp_r.write(rd(kRidReserved, 0xDDDD'0000), 34);

      auto obs = dut.settle();

      REQUIRE(obs.upq_r.has_value());
      REQUIRE(obs.upq_r->data.rid.to_ulong() == kRidReserved);
      REQUIRE_FALSE(obs.tdsu_r.has_value());
      REQUIRE_FALSE(obs.tcm_master_r.has_value());
   }
}

TEST_CASE("fabric: rid survives a round trip through AXI_HP") {
   Harness h{};
   auto& dut = h.dut;

   dut.dpq_arb_ar.write(ar(kRidUse1, kHpAddr), 41);
   auto req = dut.settle();

   REQUIRE(req.axi_hp_ar.has_value());
   REQUIRE(req.axi_hp_ar->data.arid.to_ulong() == kRidUse1);

   // The test plays the AXI_HP slave: return a beat under the id it saw.
   const auto rid = static_cast<uint8_t>(req.axi_hp_ar->data.arid.to_ulong());
   dut.axi_hp_r.write(rd(rid, 0xDEAD'BEEF), 42);
   auto rsp = dut.settle();

   REQUIRE(rsp.upq_r.has_value());
   REQUIRE(rsp.upq_r->data.rid.to_ulong() == kRidUse1);
   REQUIRE(rsp.upq_r->data.rdata.to_ulong() == 0xDEAD'BEEFu);
   REQUIRE(rsp.upq_r->tag == 42);
}

TEST_CASE("fabric: rid survives a round trip through TCM_Slave") {
   Harness h{};
   auto& dut = h.dut;

   dut.dpq_arb_ar.write(ar(kRidUse2, kTcmAddr), 43);
   auto req = dut.settle();

   REQUIRE(req.tcm_slave_ar.has_value());
   REQUIRE(req.tcm_slave_ar->data.arid.to_ulong() == kRidUse2);

   // The test plays the TCM slave this time; the response still lands at UPQ.
   const auto rid = static_cast<uint8_t>(req.tcm_slave_ar->data.arid.to_ulong());
   dut.tcm_slave_r.write(rd(rid, 0xFEED'FACE), 44);
   auto rsp = dut.settle();

   REQUIRE(rsp.upq_r.has_value());
   REQUIRE(rsp.upq_r->data.rid.to_ulong() == kRidUse2);
   REQUIRE(rsp.upq_r->data.rdata.to_ulong() == 0xFEED'FACEu);
   REQUIRE(rsp.upq_r->tag == 44);
}

TEST_CASE("fabric: a TDSU ifetch round trip returns to TDSU") {
   Harness h{};
   auto& dut = h.dut;

   // TDSU's own AR reaches AXI_HP through ARB[0]...
   dut.tdsu_ar.write(ar(kRidTdsuIfetch, kHpAddr), 45);
   auto req = dut.settle();

   REQUIRE(req.axi_hp_ar.has_value());
   REQUIRE(req.axi_hp_ar->data.arid.to_ulong() == kRidTdsuIfetch);

   // ...and the response comes back down SPLIT[3] and SPLIT[4] to TDSU.
   const auto rid = static_cast<uint8_t>(req.axi_hp_ar->data.arid.to_ulong());
   dut.axi_hp_r.write(rd(rid, 0x0BAD'C0DE), 46);
   auto rsp = dut.settle();

   REQUIRE(rsp.tdsu_r.has_value());
   REQUIRE(rsp.tdsu_r->data.rid.to_ulong() == kRidTdsuIfetch);
   REQUIRE(rsp.tdsu_r->data.rdata.to_ulong() == 0x0BAD'C0DEu);
   REQUIRE(rsp.tdsu_r->tag == 46);
   REQUIRE_FALSE(rsp.upq_r.has_value());
}

TEST_CASE("fabric: ARB[0] serializes TDSU.AR and DPQ_ARB.AR without loss") {
   Harness h{};
   auto& dut = h.dut;

   // Both masters present a request in the same cycle. DPQ's address is
   // outside the TCM window, so SPLIT[0] offers it to ARB[0] as a contender.
   dut.tdsu_ar.write(ar(kRidTdsuIfetch, kHpAddr), 51);
   dut.dpq_arb_ar.write(ar(kRidUse2, kHpAddr), 52);

   auto first = dut.settle();

   // ARB[0] is fixed priority, so TDSU wins the contended cycle.
   REQUIRE(first.axi_hp_ar.has_value());
   REQUIRE(first.axi_hp_ar->tag == 51);
   REQUIRE(first.axi_hp_ar->data.arid.to_ulong() == kRidTdsuIfetch);

   // The loser was held, not dropped: it goes out on the very next cycle.
   auto second = dut.step();

   REQUIRE(second.axi_hp_ar.has_value());
   REQUIRE(second.axi_hp_ar->tag == 52);
   REQUIRE(second.axi_hp_ar->data.arid.to_ulong() == kRidUse2);

   SECTION("and nothing else follows the two requests") {
      auto third = dut.step();
      REQUIRE_FALSE(third.axi_hp_ar.has_value());
   }
}

TEST_CASE("fabric: ARB[1] serializes TCM_Slave.R and AXI_HP.R without loss") {
   Harness h{};
   auto& dut = h.dut;

   // Both response sources are valid in the same cycle. The AXI_HP beat
   // carries an XU id, so SPLIT[3] offers it to ARB[1] as a contender.
   dut.tcm_slave_r.write(rd(kRidUse0, 0xAAAA'AAAA), 61);
   dut.axi_hp_r.write(rd(kRidUse1, 0xBBBB'BBBB), 62);

   auto first = dut.settle();

   // ARB[1] is fixed priority, so TCM_Slave wins the contended cycle.
   REQUIRE(first.upq_r.has_value());
   REQUIRE(first.upq_r->tag == 61);
   REQUIRE(first.upq_r->data.rdata.to_ulong() == 0xAAAA'AAAAu);

   // The AXI_HP beat was held behind it rather than discarded.
   auto second = dut.step();

   REQUIRE(second.upq_r.has_value());
   REQUIRE(second.upq_r->tag == 62);
   REQUIRE(second.upq_r->data.rdata.to_ulong() == 0xBBBB'BBBBu);
}

TEST_CASE("fabric: a full AXI_HP.AR holds a request instead of dropping it") {
   Harness h{};
   auto& dut = h.dut;

   // Fill AXI_HP.AR to its depth of two and leave it undrained.
   dut.tdsu_ar.write(ar(kRidTdsuIfetch, kHpAddr), 71);
   dut.step_no_drain();
   dut.tdsu_ar.write(ar(kRidTdsuIfetch, kHpAddr), 72);
   dut.step_no_drain();
   dut.step_no_drain();
   REQUIRE_FALSE(view<ArChannelSink>(dut.axi_hp).ready());

   // A DPQ request that decodes to AXI_HP now has nowhere to go.
   dut.dpq_arb_ar.write(ar(kRidUse2, kHpAddr), 73);
   dut.step_no_drain();
   dut.step_no_drain();

   // It must still be sitting in its own channel, untouched.
   REQUIRE(view<ArChannelSource>(dut.dpq_arb).valid());
   REQUIRE(view<ArChannelSource>(dut.dpq_arb).peek_data()->arid.to_ulong() == kRidUse2);

   // Draining AXI_HP.AR lets the backlog through, in order and with tags intact.
   auto a = dut.step();
   auto b = dut.step();
   auto c = dut.step();

   REQUIRE(a.axi_hp_ar.has_value());
   REQUIRE(a.axi_hp_ar->tag == 71);
   REQUIRE(b.axi_hp_ar.has_value());
   REQUIRE(b.axi_hp_ar->tag == 72);
   REQUIRE(c.axi_hp_ar.has_value());
   REQUIRE(c.axi_hp_ar->tag == 73);
   REQUIRE(c.axi_hp_ar->data.arid.to_ulong() == kRidUse2);
}

TEST_CASE("fabric: a TDSU ifetch return is not blocked by a full TCM_Master.R") {
   Harness h{};
   auto& dut = h.dut;

   // Fill TCM_Master.R to its depth of two and leave it undrained.
   dut.axi_hp_r.write(rd(kRidTcmFill, 0x1111'1111), 81);
   dut.step_no_drain();
   dut.axi_hp_r.write(rd(kRidTcmFill, 0x2222'2222), 82);
   dut.step_no_drain();
   dut.step_no_drain();
   REQUIRE_FALSE(view<RChannelSink>(dut.tcm_master).ready());

   // SPLIT[4]'s two destinations are independent, so an ifetch return takes
   // its own path rather than queueing behind a TCM fill it has nothing to
   // do with.
   dut.axi_hp_r.write(rd(kRidTdsuIfetch, 0x3333'3333), 83);
   dut.step_no_drain();
   dut.step_no_drain();

   REQUIRE(view<RChannelSource>(dut.tdsu).valid());
   REQUIRE(view<RChannelSource>(dut.tdsu).peek_data()->rdata.to_ulong() == 0x3333'3333u);
}

TEST_CASE("fabric: a TDSU ifetch return is held when TDSU.R is full") {
   Harness h{};
   auto& dut = h.dut;

   // Fill TDSU.R to its depth of two and leave it undrained.
   dut.axi_hp_r.write(rd(kRidTdsuIfetch, 0x4444'4444), 91);
   dut.step_no_drain();
   dut.axi_hp_r.write(rd(kRidTdsuIfetch, 0x5555'5555), 92);
   dut.step_no_drain();
   dut.step_no_drain();
   REQUIRE_FALSE(view<RChannelSink>(dut.tdsu).ready());

   // TCM_Master.R is wide open, but that must not license a write into a full
   // TDSU.R: the beat is held in AXI_HP.R instead.
   dut.axi_hp_r.write(rd(kRidTdsuIfetch, 0x6666'6666), 93);
   dut.step_no_drain();
   REQUIRE_NOTHROW(dut.step_no_drain());

   REQUIRE(view<RChannelSource>(dut.axi_hp).valid());
   REQUIRE(view<RChannelSource>(dut.axi_hp).peek_data()->rdata.to_ulong() == 0x6666'6666u);
   REQUIRE_FALSE(view<RChannelSource>(dut.tcm_master).valid());
}

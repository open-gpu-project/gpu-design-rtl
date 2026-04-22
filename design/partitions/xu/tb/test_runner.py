from pathlib import Path

from cocotb_tools.runner import get_runner


# def test_adder():
#     proj = Path(__file__).resolve().parent
#     rtl = proj / ".." / "rtl" /"adder.sv"
#     build_dir = proj.parent / "sim_build"

#     runner = get_runner("verilator")

#     runner.build(
#         sources=[rtl],
#         hdl_toplevel="adder",
#         build_dir=build_dir,
#         waves=True,
#     )

#     runner.test(
#         hdl_toplevel="adder",
#         test_module="test_adder",
#         build_dir=build_dir,
#         waves=True,
#     )
   
def test_alu_lane():
    proj = Path(__file__).resolve().parent
    rtl_dir = (proj / ".." / "rtl").resolve()
    rtl = rtl_dir / "alu_lane.sv"
    dsp_wrapper = rtl_dir / "alu_dsp_wrapper.sv"
    dsp_primitive = (rtl_dir / ".." / ".." / ".." / "libraries" / "unisim" / "DSP48E1.sv").resolve()
    build_dir = proj.parent / "sim_build"
    waiver = proj / "dsp_waiver.vlt"


    runner = get_runner("verilator")

    runner.build(
        sources=[rtl, dsp_wrapper, dsp_primitive],
        includes=[rtl_dir],
        build_args=["--no-timing", "-Wno-fatal", str(waiver)],
        hdl_toplevel="alu_lane",
        build_dir=build_dir,
        waves=True,
    )

    runner.test(
        hdl_toplevel="alu_lane",
        test_module="test_alu_lane",
        build_dir=build_dir,
        waves=True,
        gui=True,
    )

if __name__ == "__main__":
    test_adder()
    test_alu_lane()

#include <filesystem>
#include <fstream>
#include <glm/glm.hpp>
#include <string_view>

class GpuDriver {
public:
};

static void LoadObj(std::filesystem::path const& path) {
   std::ifstream ifs{path, std::ios::in};
   if (!ifs) throw std::runtime_error("Failed to open OBJ file: " + path.string());
}

int main() {}

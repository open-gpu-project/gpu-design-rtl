// clang-format off
#include "glad.h" // Leave at very top, before GLFW is included
#include <GLFW/glfw3.h> // Will drag system OpenGL headers
// clang-format on

#include <cstdlib>
#include <iostream>

#include "imgui.h"
#include "imgui_impl_glfw.h"
#include "imgui_impl_opengl3.h"

#define TINYOBJLOADER_IMPLEMENTATION
#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

#include <glm/gtc/type_ptr.hpp>
#include "camera.h"
#include "shader.h"
#include "tiny_obj_loader.h"


Camera camera;

double lastx, lasty;
double cursorx, cursory;

bool mouse_capture = true;

void mouse_callback(GLFWwindow* window, double xpos, double ypos) {
   cursorx = xpos;
   cursory = ypos;
   if (mouse_capture) {
      camera.ProcessMouseMovement(xpos - lastx, lasty - ypos);
   }
   lastx = xpos;
   lasty = ypos;
   ImGui_ImplGlfw_CursorPosCallback(window, xpos, ypos);
}

static void glfw_error_callback(int error, const char* description) {
   std::cerr << "GLFW Error " << error << ": " << description << std::endl;
}

// Main code
int main(int, char**) {
   // FIXME(kevin): Possibly Pop-OS specific wayland only...!
   setenv("XCURSOR_SIZE", "24", 0);

   glfwSetErrorCallback(glfw_error_callback);
   if (!glfwInit()) return 1;

   // Decide GL+GLSL versions
#if defined(IMGUI_IMPL_OPENGL_ES2)
   // GL ES 2.0 + GLSL 100 (WebGL 1.0)
   const char* glsl_version = "#version 100";
   glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 2);
   glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 0);
   glfwWindowHint(GLFW_CLIENT_API, GLFW_OPENGL_ES_API);
#elif defined(IMGUI_IMPL_OPENGL_ES3)
   // GL ES 3.0 + GLSL 300 es (WebGL 2.0)
   const char* glsl_version = "#version 300 es";
   glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
   glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 0);
   glfwWindowHint(GLFW_CLIENT_API, GLFW_OPENGL_ES_API);
#elif defined(__APPLE__)
   // GL 3.2 + GLSL 150
   const char* glsl_version = "#version 150";
   glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
   glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 2);
   glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE); // 3.2+ only
   glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);           // Required on Mac
#else
   // GL 3.0 + GLSL 130
   const char* glsl_version = "#version 130";
   glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
   glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 0);
   // glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);  // 3.2+ only
   // glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);            // 3.0+ only
#endif

   // Set up High-DPI scaling
   float highDPIScaleFactor = 1.0f;
   {
      GLFWmonitor* monitor = glfwGetPrimaryMonitor();
      float scaleX, scaleY;
      glfwGetMonitorContentScale(monitor, &scaleX, &scaleY);
      if (scaleX > 1 || scaleY > 1) {
         highDPIScaleFactor = std::max(scaleX, scaleY);
         // FIXME(kevin): HiDPI for Windows, I think
         glfwWindowHint(GLFW_SCALE_TO_MONITOR, GLFW_TRUE);
         // FIXME(kevin): HiDPI for Linux Wayland systems, I think
         glfwWindowHint(GLFW_SCALE_FRAMEBUFFER, GLFW_TRUE);
      }
      std::cout << "Monitor scaling factor: " << scaleX << std::endl;
   }

   // Create window with graphics context
   GLFWwindow* window = glfwCreateWindow(1280, 720, "...", nullptr, nullptr);
   if (window == nullptr) {
      std::cerr << "Failed to create GLFW window" << std::endl;
      return -1;
   }
   glfwMakeContextCurrent(window);
   glfwSwapInterval(1); // Enable vsync

   // Load the OpenGL APIs
   if (!gladLoadGLLoader((GLADloadproc)glfwGetProcAddress)) {
      std::cerr << "Failed to initialize GLAD" << std::endl;
      return -1;
   }

   // Set up ImGui context
   auto ctx = ImGui::CreateContext();
   ImGui::SetCurrentContext(ctx);

   // Setup Platform/Renderer backends
   ImGui_ImplGlfw_InitForOpenGL(window, true);
   ImGui_ImplOpenGL3_Init(glsl_version);

   // Scale ImGui
   ImGui::GetStyle().ScaleAllSizes(highDPIScaleFactor);
   ImGui::GetStyle().FontScaleMain = highDPIScaleFactor;

   // Load resources/fonts/settings/...
   // ...

   const std::string projectRoot = PROJECT_ROOT;
   const std::string objPath = projectRoot + "/archsim/third-party/sponza-model/sponza.obj";
   const std::string dir = projectRoot + "/archsim/third-party/sponza-model/";

   Shader mainShader((projectRoot + "/archsim/stdref-cpp/main.vert").c_str(),
                     (projectRoot + "/archsim/stdref-cpp/main.frag").c_str());

   tinyobj::attrib_t attrib;                   // holds vertex arrays
   std::vector<tinyobj::shape_t> shapes;       // holds faces grouped into objects
   std::vector<tinyobj::material_t> materials; // holds material info
   std::string warn, err;

   bool ret = tinyobj::LoadObj(&attrib, &shapes, &materials, &warn, &err,
                               objPath.c_str(), // path to OBJ
                               dir.c_str(),     // path to MTL + textures
                               true             // triangulate polygons
   );

   if (!warn.empty()) std::cout << "WARN: " << warn << "\n";
   if (!err.empty()) std::cerr << "ERR: " << err << "\n";
   if (!ret) return 1;

   std::cout << "Loaded " << shapes.size() << " shapes\n";
   std::cout << "Loaded " << materials.size() << " materials\n";

   std::map<int, std::vector<tinyobj::index_t>> materialGroup;

   std::map<std::string, GLuint> loaded_texture;

   std::set<std::string> tex_names;

   for (const tinyobj::material_t mat : materials) {
      std::cout << mat.name << "\n";
      if (!mat.diffuse_texname.empty() && !tex_names.contains(mat.diffuse_texname)) {
         std::cout << "diffuse: " << mat.diffuse_texname << "\n";
         tex_names.insert(mat.diffuse_texname);
      }
      if (!mat.specular_texname.empty()) {
         std::cout << "specular: " << mat.specular_texname << "\n";
         tex_names.insert(mat.specular_texname);
      }
      if (!mat.alpha_texname.empty()) {
         std::cout << "alpha: " << mat.alpha_texname << "\n";
         tex_names.insert(mat.alpha_texname);
      }
      if (!mat.displacement_texname.empty()) {
         std::cout << "displacement: " << mat.displacement_texname << "\n";
         tex_names.insert(mat.displacement_texname);
      }
      std::cout << "\n";
   }

   for (const std::string tex_name : tex_names) {
         if (!loaded_texture.contains(tex_name)) {
      stbi_set_flip_vertically_on_load(true);
      GLuint textureID;
      glGenTextures(1, &textureID);
      glBindTexture(GL_TEXTURE_2D, textureID);
      int width, height, channels;
      unsigned char* data = stbi_load((dir + tex_name).c_str(), &width, &height, &channels, 0);
      GLenum format = GL_RGB;
      if (channels == 1)
         format = GL_RED;
      else if (channels == 3)
         format = GL_RGB;
      else if (channels == 4)
         format = GL_RGBA;

      glPixelStorei(GL_UNPACK_ALIGNMENT, 1);

      glTexImage2D(GL_TEXTURE_2D, 0, format, width, height, 0, format, GL_UNSIGNED_BYTE, data);
      glGenerateMipmap(GL_TEXTURE_2D);

      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_REPEAT);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_REPEAT);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);

      stbi_image_free(data);

      loaded_texture[tex_name] = textureID;
         }
   }

   for (const auto &currentShape:shapes) {
      tinyobj::mesh_t currentMesh = currentShape.mesh;
      for (int j = 0; j + 2 < currentMesh.indices.size(); j += 3) {
         int currentMaterialID = currentMesh.material_ids.at(j / 3);
         materialGroup[currentMaterialID].push_back(currentMesh.indices.at(j));
         materialGroup[currentMaterialID].push_back(currentMesh.indices.at(j + 1));
         materialGroup[currentMaterialID].push_back(currentMesh.indices.at(j + 2));
      }
   }

   struct Vertex {
      float position[3];
      float normal[3];
      float uv[2];
      float tangent[3];
      float bitangent[3];
      

      // Strict lexicographic compare (avoids memcmp/padding issues)
      bool operator<(const Vertex& v) const {
         for (int i = 0; i < 3; ++i)
            if (position[i] != v.position[i]) return position[i] < v.position[i];
         for (int i = 0; i < 3; ++i)
            if (normal[i] != v.normal[i]) return normal[i] < v.normal[i];
         for (int i = 0; i < 2; ++i)
            if (uv[i] != v.uv[i]) return uv[i] < v.uv[i];
         for (int i = 0; i < 3; ++i)
            if (tangent[i] != v.tangent[i]) return tangent[i] < v.tangent[i];
         for (int i = 0; i < 3; ++i)
            if (bitangent[i] != v.bitangent[i]) return bitangent[i] < v.bitangent[i];
         return false;
      }
   };
   static_assert(sizeof(Vertex) == 14 * sizeof(float), "Vertex has unexpected padding");

   struct Mesh {
      int materialID;
      int startIndex;
      int size;
   };

   std::vector<Vertex> vertices;
   std::map<Vertex, int> vertexMap;
   std::vector<int> indices;
   std::vector<Mesh> mesh;

   int startIndex = 0;

   for (int i = 0; i < materials.size(); i++) {
      std::vector<tinyobj::index_t> m_indices = materialGroup[i];

      Mesh currentMesh;
      currentMesh.materialID = i;
      currentMesh.startIndex = startIndex;

      for (int j = 0; j < m_indices.size(); j++) {
         tinyobj::index_t currentIndex = m_indices[j];
         float position[3], normal[3], uv[2];
         position[0] = attrib.vertices[3 * currentIndex.vertex_index];
         position[1] = attrib.vertices[3 * currentIndex.vertex_index + 1];
         position[2] = attrib.vertices[3 * currentIndex.vertex_index + 2];
         normal[0] = attrib.normals[3 * currentIndex.normal_index];
         normal[1] = attrib.normals[3 * currentIndex.normal_index + 1];
         normal[2] = attrib.normals[3 * currentIndex.normal_index + 2];
         uv[0] = attrib.texcoords[2 * currentIndex.texcoord_index];
         uv[1] = attrib.texcoords[2 * currentIndex.texcoord_index + 1];

         Vertex v = {{position[0], position[1], position[2]},
                     {normal[0], normal[1], normal[2]},
                     {uv[0], uv[1]},
                     {0,0,0}, // tangent placeholder
                     {0,0,0} // bitangent placeholder
                  };
         if (vertexMap.count(v) == 0) {
            vertexMap[v] = vertices.size();
            vertices.push_back(v);
         }
         indices.push_back(vertexMap[v]);
      }
      startIndex += m_indices.size();
      currentMesh.size = m_indices.size();
      mesh.push_back(currentMesh);
   }

   std::map<int,glm::vec3> accTangents;
   std::map<int,glm::vec3> accBitangents;

   // Initialize tangent and bitangent accumulators to zero for all vertices
   for (int i = 0; i < vertices.size(); ++i) {
      accTangents[i] = glm::vec3(0.0f);
      accBitangents[i] = glm::vec3(0.0f);
   }

   for (int i = 0; i < indices.size(); i += 3){
      Vertex vert1 = vertices.at(indices[i]);
      Vertex vert2 = vertices.at(indices[i+1]);
      Vertex vert3 = vertices.at(indices[i+2]);
      float uv1[2] = { vert1.uv[0], vert1.uv[1] };
      float uv2[2] = { vert2.uv[0], vert2.uv[1] };
      float uv3[2] = { vert3.uv[0], vert3.uv[1] };
      float u1 = uv2[0]-uv1[0];
      float u2 = uv3[0]-uv1[0];
      float v1 = uv2[1]-uv1[1];
      float v2 = uv3[1]-uv1[1];
      glm::vec3 e1 = glm::make_vec3(vert2.position) - glm::make_vec3(vert1.position);
      glm::vec3 e2 = glm::make_vec3(vert3.position) - glm::make_vec3(vert1.position);
      float det = (u1*v2-v1*u2);
      if (abs(det) < 0.0001)
         continue;
      float f = 1/det;
      glm::mat2 inv = f * glm::mat2(v2, -v1, -u2, u1);
      glm::mat3x2 e;
      e[0][0] = e1.x; e[0][1] = e2.x;
      e[1][0] = e1.y; e[1][1] = e2.y;
      e[2][0] = e1.z; e[2][1] = e2.z;
      glm::mat3x2 result = inv * e;
      glm::vec3 tangent = glm::transpose(result)[0];
      glm::vec3 bitangent = glm::transpose(result)[1];
      // glm::vec3 tangent = (e1 * v2 - e2 * v1) / det;
      // glm::vec3 bitangent = (e2 * u1 - e1 * u2) / det;
      accTangents[indices[i]] += tangent;
      accTangents[indices[i+1]] += tangent;
      accTangents[indices[i+2]] += tangent;
      accBitangents[indices[i]] += bitangent;
      accBitangents[indices[i+1]] += bitangent;
      accBitangents[indices[i+2]] += bitangent;
   }

   for (int i = 0; i < vertices.size(); ++i) {
      glm::vec3 T = normalize(accTangents[i]);
      glm::vec3 B = normalize(accBitangents[i]);
      glm::vec3 N = normalize(glm::make_vec3(vertices[i].normal));

      // Gram-Schmidt orthogonalization
      T = glm::normalize(T - glm::dot(T, N) * N);
      
      // Check for "handedness" (optional but good practice)
      if (glm::dot(glm::cross(N, T), B) < 0.0f) {
         T *= -1.0f;
      }

      // Store the final vectors in the vertex data
      vertices.at(i).tangent[0] = T.x;
      vertices.at(i).tangent[1] = T.y;
      vertices.at(i).tangent[2] = T.z;
      vertices.at(i).bitangent[0] = B.x;
      vertices.at(i).bitangent[1] = B.y;
      vertices.at(i).bitangent[2] = B.z;
   }

   std::cout << "Loaded " << vertices.size() << " vertices" << "\n";
   std::cout << "Loaded " << indices.size() / 3 << " triangles" << "\n";

   unsigned int VBO, VAO, EBO;
   glGenVertexArrays(1, &VAO);
   glGenBuffers(1, &VBO);
   glGenBuffers(1, &EBO);

   glBindVertexArray(VAO);

   glBindBuffer(GL_ARRAY_BUFFER, VBO);
   glBufferData(GL_ARRAY_BUFFER, vertices.size() * sizeof(Vertex), vertices.data(), GL_STATIC_DRAW);

   glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, EBO);
   glBufferData(GL_ELEMENT_ARRAY_BUFFER, indices.size() * sizeof(int), indices.data(),
                GL_STATIC_DRAW);

   // vertex position
   glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 14 * sizeof(float), (void*)0);
   glEnableVertexAttribArray(0);

   // normal
   glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 14 * sizeof(float), (void*)(3 * sizeof(float)));
   glEnableVertexAttribArray(1);

   // texture coordinates
   glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, 14 * sizeof(float), (void*)(6 * sizeof(float)));
   glEnableVertexAttribArray(2);

   // tangent
   glVertexAttribPointer(3, 3, GL_FLOAT, GL_FALSE, 14 * sizeof(float), (void*)(8 * sizeof(float)));
   glEnableVertexAttribArray(3);

   // bitangent
   glVertexAttribPointer(4, 3, GL_FLOAT, GL_FALSE, 14 * sizeof(float), (void*)(11 * sizeof(float)));
   glEnableVertexAttribArray(4);

   glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_DISABLED);

   glfwSetCursorPosCallback(window, mouse_callback);

   glEnable(GL_DEPTH_TEST);

   float deltaTime = 0.0f;
   float lastFrame = 0.0f;

   float fov = 45;
   camera.MovementSpeed = 300.0f;
   camera.MouseSensitivity = 0.3f;
   bool wireframe = false;

   // lighting
   unsigned int lightVAO, lightVBO;
   glGenVertexArrays(1, &lightVAO);
   glBindVertexArray(lightVAO);

   glGenBuffers(1, &lightVBO);
   glBindBuffer(GL_ARRAY_BUFFER, lightVBO);

   float cubeVertices[] = {-0.5f, -0.5f, -0.5f, 0.5f,  -0.5f, -0.5f, 0.5f,  0.5f,  -0.5f,
                           0.5f,  0.5f,  -0.5f, -0.5f, 0.5f,  -0.5f, -0.5f, -0.5f, -0.5f,

                           -0.5f, -0.5f, 0.5f,  0.5f,  -0.5f, 0.5f,  0.5f,  0.5f,  0.5f,
                           0.5f,  0.5f,  0.5f,  -0.5f, 0.5f,  0.5f,  -0.5f, -0.5f, 0.5f,

                           -0.5f, 0.5f,  0.5f,  -0.5f, 0.5f,  -0.5f, -0.5f, -0.5f, -0.5f,
                           -0.5f, -0.5f, -0.5f, -0.5f, -0.5f, 0.5f,  -0.5f, 0.5f,  0.5f,

                           0.5f,  0.5f,  0.5f,  0.5f,  0.5f,  -0.5f, 0.5f,  -0.5f, -0.5f,
                           0.5f,  -0.5f, -0.5f, 0.5f,  -0.5f, 0.5f,  0.5f,  0.5f,  0.5f,

                           -0.5f, -0.5f, -0.5f, 0.5f,  -0.5f, -0.5f, 0.5f,  -0.5f, 0.5f,
                           0.5f,  -0.5f, 0.5f,  -0.5f, -0.5f, 0.5f,  -0.5f, -0.5f, -0.5f,

                           -0.5f, 0.5f,  -0.5f, 0.5f,  0.5f,  -0.5f, 0.5f,  0.5f,  0.5f,
                           0.5f,  0.5f,  0.5f,  -0.5f, 0.5f,  0.5f,  -0.5f, 0.5f,  -0.5f};
   glBufferData(GL_ARRAY_BUFFER, sizeof(cubeVertices), cubeVertices, GL_STATIC_DRAW);

   glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 3 * sizeof(float), (void*)0);
   glEnableVertexAttribArray(0);

   Shader lightCubeShader((projectRoot + "/archsim/stdref-cpp/lightCube.vert").c_str(),
                           (projectRoot + "/archsim/stdref-cpp/lightCube.frag").c_str());
   std::cout << "light cube ready" << "\n";

   float lightPos[3] = {0.0f, 200.0f, 0.0f};
   float lightColor[3] = {1.0f, 1.0f, 1.0f};
   float lightAttenuationConstants[3] = {1.0f, 0.000009f, 0.0000032f};
   float lightIntensity = 0.5f;

   glEnable(GL_BLEND);
   glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE);

   bool blinn = false;
   enum LightType { None, Point, Directional };
   LightType lightType = Point;

   static glm::vec3 lightDir(0.0f, -1.0f, 0.0f);

    const unsigned int SHADOW_WIDTH = 4096, SHADOW_HEIGHT = 4096;
    unsigned int depthMapFBO;
    glGenFramebuffers(1, &depthMapFBO);
    // create depth texture
    unsigned int depthMap;
    glGenTextures(1, &depthMap);
    glBindTexture(GL_TEXTURE_2D, depthMap);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH_COMPONENT, SHADOW_WIDTH, SHADOW_HEIGHT, 0, GL_DEPTH_COMPONENT, GL_FLOAT, NULL);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_BORDER);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_BORDER);
    float borderColor[] = { 1.0, 1.0, 1.0, 1.0 };
    glTexParameterfv(GL_TEXTURE_2D, GL_TEXTURE_BORDER_COLOR, borderColor);
    // attach depth texture as FBO's depth buffer
    glBindFramebuffer(GL_FRAMEBUFFER, depthMapFBO);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, depthMap, 0);
    glDrawBuffer(GL_NONE);
    glReadBuffer(GL_NONE);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);

       Shader depthShader((projectRoot + "/archsim/stdref-cpp/depth.vert").c_str(),
                     (projectRoot + "/archsim/stdref-cpp/depth.frag").c_str());

   // Main loop
   auto& io = ImGui::GetIO();
   ImVec4 clear_color = ImVec4(0.45f, 0.55f, 0.60f, 1.00f);
   while (!glfwWindowShouldClose(window)) {
      // Poll and handle events (inputs, window resize, etc.)
      glfwPollEvents();

      // If the window has not been set up, wait a little
      if (glfwGetWindowAttrib(window, GLFW_ICONIFIED) != 0) {
         ImGui_ImplGlfw_Sleep(10);
         continue;
      }

      // Start the Dear ImGui frame
      ImGui_ImplOpenGL3_NewFrame();
      ImGui_ImplGlfw_NewFrame();
      ImGui::NewFrame();

      // Perform per-frame action
      // ...
      float currentTime = (float)glfwGetTime();
      deltaTime = currentTime - lastFrame;
      lastFrame = currentTime;

      ImGui::Begin("Debug Info");
      ImGui::Text("FPS: %.1f (%.3f ms)", io.Framerate, 1000.0f / io.Framerate);
      ImGui::Text("Position x: %.3f y: %.3f z: %.3f", camera.Position.x, camera.Position.y,
                  camera.Position.z);
      ImGui::Text("Lookat x: %.3f y: %3f z: %3f", camera.Front.x, camera.Front.y, camera.Front.z);
      ImGui::Text("cursor x: %.3f", cursorx);
      ImGui::Text("cursor y: %.3f", cursory);
      ImGui::End();

      ImGui::Begin("Settings");
      ImGui::SliderFloat("speed", &camera.MovementSpeed, 0.0f, 500.0f);
      ImGui::SliderFloat("fov", &fov, 0.0f, 180.0f);
      ImGui::Checkbox("wireframe", &wireframe);

      if (ImGui::RadioButton("None", lightType == None)) lightType = None;
      if (ImGui::RadioButton("Point", lightType == Point)) {
         lightType = Point;
      }
      if (ImGui::RadioButton("Directional", lightType == Directional)) {
         lightType = Directional;
      }

      if (lightType == Point) {
         ImGui::DragFloat3("light position", lightPos, 1.0f, -3000.0f, 3000.0f);
         ImGui::ColorEdit3("color", lightColor);
         ImGui::SliderFloat("light intensity", &lightIntensity, 0.0f, 5.0f);
         ImGui::DragFloat3("attenuation", lightAttenuationConstants, 0.0000001f, -3.0f, 3.0f,
                           "%.7f");
         ImGui::Checkbox("blinn", &blinn);
      } else if (lightType == Directional) {
         if (ImGui::DragFloat3("light direction", &lightDir[0], 0.0001f, -1.0f, 1.0f)) {
            lightDir = glm::normalize(lightDir); // keep it normalized
         }
         ImGui::ColorEdit3("color", lightColor);
         ImGui::SliderFloat("light intensity", &lightIntensity, 0.0f, 5.0f);
         ImGui::Checkbox("blinn", &blinn);
      }

      ImGui::End();

      glm::mat4 lightProjection, lightView;
      glm::mat4 lightModel2 = glm::mat4(1.0f);
        glm::mat4 lightSpaceMatrix;
        float near_plane = 1.0f, far_plane = 7000.0f;
        //lightProjection = glm::perspective(glm::radians(45.0f), (GLfloat)SHADOW_WIDTH / (GLfloat)SHADOW_HEIGHT, near_plane, far_plane); // note that if you use a perspective projection matrix you'll have to change the light position as the current light position isn't enough to reflect the whole scene
        lightProjection = glm::ortho(-1300.0f, 1300.0f, -1500.0f, 1500.0f, near_plane, far_plane);
        lightProjection = glm::scale(lightProjection, glm::vec3(0.6));
        lightView = glm::lookAt(lightDir*(-3000.0f), glm::vec3(0.0f), glm::vec3(0.0, 1.0, 0.0));
        lightSpaceMatrix = lightProjection * lightView;
        // render scene from light's point of view
        depthShader.use();
        depthShader.setMat4("lightSpaceMatrix", lightSpaceMatrix);
         depthShader.setMat4("model", lightModel2);

        glViewport(0, 0, SHADOW_WIDTH, SHADOW_HEIGHT);
        glBindFramebuffer(GL_FRAMEBUFFER, depthMapFBO);
         glClear(GL_DEPTH_BUFFER_BIT);
         glBindVertexArray(VAO);
         for (auto m :mesh) {
            glDrawElements(GL_TRIANGLES, m.size, GL_UNSIGNED_INT, (void*)(m.startIndex * sizeof(int)));
         }
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
      
        ImGui::Begin("Shadow Map");
         ImTextureID id = (ImTextureID)(intptr_t) depthMap;

         // flip V (OpenGL’s origin is bottom-left; ImGui’s is top-left)
         ImVec2 uv0 = ImVec2(0, 1);
         ImVec2 uv1 = ImVec2(1, 0);

         // pick a display size (pixels)
         ImGui::Image(id, ImVec2(256, 256), uv0, uv1);
         ImGui::End();

      // Rendering
      ImGui::Render();
      int display_w, display_h;
      glfwGetFramebufferSize(window, &display_w, &display_h);
      glViewport(0, 0, display_w, display_h);
      glClearColor(clear_color.x * clear_color.w, clear_color.y * clear_color.w,
                   clear_color.z * clear_color.w, clear_color.w);
      glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

      if (glfwGetKey(window, GLFW_KEY_W) == GLFW_PRESS) camera.ProcessKeyboard(FORWARD, deltaTime);
      if (glfwGetKey(window, GLFW_KEY_S) == GLFW_PRESS) camera.ProcessKeyboard(BACKWARD, deltaTime);
      if (glfwGetKey(window, GLFW_KEY_A) == GLFW_PRESS) camera.ProcessKeyboard(LEFT, deltaTime);
      if (glfwGetKey(window, GLFW_KEY_D) == GLFW_PRESS) camera.ProcessKeyboard(RIGHT, deltaTime);
      if (glfwGetKey(window, GLFW_KEY_SPACE) == GLFW_PRESS) camera.ProcessKeyboard(UP, deltaTime);
      if (glfwGetKey(window, GLFW_KEY_LEFT_SHIFT) == GLFW_PRESS)
         camera.ProcessKeyboard(DOWN, deltaTime);
      if (glfwGetKey(window, GLFW_KEY_ESCAPE) == GLFW_PRESS) {
         glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_NORMAL);
         mouse_capture = false;
      }
      if (glfwGetKey(window, GLFW_KEY_F) == GLFW_PRESS) {
         glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_DISABLED);
         mouse_capture = true;
      }

      glm::mat4 view = glm::mat4(1.0f);
      view = camera.GetViewMatrix();

      glm::mat4 projection;
      projection = glm::perspective(glm::radians(fov), 1280.0f / 720.0f, 0.1f, 3000.0f);

      glm::mat4 model = glm::mat4(1.0f);

      mainShader.use();

      mainShader.setMat4("model",model);
      mainShader.setMat4("view", view);
      mainShader.setMat4("projection",projection);

      switch (lightType) {
         case Point:
            mainShader.setInt("lightType", 1);
            mainShader.setVec3("light.position", glm::make_vec3(lightPos));
            // glUniform3fv(glGetUniformLocation(mainShader.ID, "light.position"), 1, lightPos);
            mainShader.setFloat("light.constant", lightAttenuationConstants[0]);
            mainShader.setFloat("light.linear", lightAttenuationConstants[1]);
            mainShader.setFloat("light.quadratic", lightAttenuationConstants[2]);
            mainShader.setBool("blinn", blinn);
            glUniform3fv(glGetUniformLocation(mainShader.ID, "lightColor"), 1, lightColor);
            glUniform3fv(glGetUniformLocation(mainShader.ID, "viewPos"), 1,
                         glm::value_ptr(camera.Position));
            mainShader.setFloat("lightIntensity", lightIntensity);
            break;
         case None:
            mainShader.setInt("lightType", 0);
            break;
         case Directional:
            mainShader.setInt("lightType", 2);
            glUniform3fv(glGetUniformLocation(mainShader.ID, "light.direction"), 1,
                         glm::value_ptr(lightDir));
            mainShader.setBool("blinn", blinn);
            glUniform3fv(glGetUniformLocation(mainShader.ID, "lightColor"), 1, lightColor);
            glUniform3fv(glGetUniformLocation(mainShader.ID, "viewPos"), 1,
                         glm::value_ptr(camera.Position));
            mainShader.setFloat("lightIntensity", lightIntensity);
            mainShader.setMat4("lightSpaceMatrix", lightSpaceMatrix);
            break;
         default:
            break;
      }

      if (wireframe) {
         glPolygonMode(GL_FRONT_AND_BACK, GL_LINE);
      } else {
         glPolygonMode(GL_FRONT_AND_BACK, GL_FILL);
      }

      glBindVertexArray(VAO);

      for (int i = 0; i < mesh.size(); i++) {
         Mesh m = mesh.at(i);
         tinyobj::material_t mat = materials.at(i);

         glActiveTexture(GL_TEXTURE1);
         glBindTexture(GL_TEXTURE_2D, loaded_texture[mat.diffuse_texname]);
         mainShader.setInt("material.diffuse",1);

         glActiveTexture(GL_TEXTURE2);
         glBindTexture(GL_TEXTURE_2D, loaded_texture[mat.specular_texname]);
         mainShader.setInt("material.specular",2);

         mainShader.setBool("hasOpacityMask", !mat.alpha_texname.empty());
         if (!mat.alpha_texname.empty()) {
            // use diffuse texture since there is actually no alpha texture file
            glActiveTexture(GL_TEXTURE3);
            glBindTexture(GL_TEXTURE_2D, loaded_texture[mat.diffuse_texname]);
            mainShader.setInt("material.alpha",3);
         }

         // displacement map is actually normal map
         glActiveTexture(GL_TEXTURE4);
          glBindTexture(GL_TEXTURE_2D, loaded_texture[mat.displacement_texname]);
         mainShader.setInt("material.normal",4);


         glActiveTexture(GL_TEXTURE5);
          glBindTexture(GL_TEXTURE_2D, depthMap);
         mainShader.setInt("depthMap",5);

         glDrawElements(GL_TRIANGLES, m.size, GL_UNSIGNED_INT, (void*)(m.startIndex * sizeof(int)));
      }

      // light
      glm::mat4 lightModel = glm::mat4(1.0f);

      switch (lightType) {
         case Point:
            lightCubeShader.use();
            lightModel = glm::translate(lightModel, glm::make_vec3(lightPos));
            lightModel = glm::scale(lightModel, glm::vec3(100.0f));
            glUniformMatrix4fv(glGetUniformLocation(lightCubeShader.ID, "model"), 1, GL_FALSE,
                               glm::value_ptr(lightModel));
            glUniformMatrix4fv(glGetUniformLocation(lightCubeShader.ID, "view"), 1, GL_FALSE,
                               glm::value_ptr(view));
            glUniformMatrix4fv(glGetUniformLocation(lightCubeShader.ID, "projection"), 1, GL_FALSE,
                               glm::value_ptr(projection));
            glUniform3fv(glGetUniformLocation(lightCubeShader.ID, "lightColor"), 1, lightColor);
            glBindVertexArray(lightVAO);
            glDrawArrays(GL_TRIANGLES, 0, 36);
            break;
         case None:
            break;
         case Directional:
            break;
         default:
            break;
      }

      ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
      glfwSwapBuffers(window);
   }

   // Cleanup
   ImGui_ImplOpenGL3_Shutdown();
   ImGui_ImplGlfw_Shutdown();
   glfwDestroyWindow(window);
   glfwTerminate();

   return 0;
}

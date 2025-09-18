#pragma once
#include <tiny_obj_loader.h>

#include <set>

#include "camera.h"
#include "shader.h"
#include "stb_image.h"
#include "utils.h"

class Model {
public:
   Model(std::string objPath, std::string mtlDir) {
      this->mtlDir = mtlDir;
      std::string warn, err;
      bool ret = tinyobj::LoadObj(&(this->attrib), &(this->shapes), &(this->materials), &warn, &err,
                                  objPath.c_str(), // path to OBJ
                                  mtlDir.c_str(),  // path to MTL + textures
                                  true             // triangulate polygons
      );

      if (!warn.empty()) std::cout << "WARN: " << warn << "\n";
      if (!err.empty()) std::cerr << "ERR: " << err << "\n";
      // if (!ret) return 1;
      std::cout << "Loaded " << shapes.size() << " shapes\n";
      std::cout << "Loaded " << materials.size() << " materials\n";
      loaded_textures = loadTextures(uniqueTexturePathsSet());
      std::tie(vertices, meshes, indices) = buildMeshes();
      std::cout << "Loaded " << vertices.size() << " vertices" << "\n";
      std::cout << "Loaded " << indices.size() / 3 << " triangles" << "\n";
      vertices = findTangentBitangent(vertices, indices);
      std::tie(VAO, VBO, EBO) = buildVAO(vertices, indices);
   }

   void render(Shader shader, bool loadTextures) {
      glBindVertexArray(VAO);
      for (int i = 0; i < meshes.size(); i++) {
         Mesh m = meshes.at(i);
         tinyobj::material_t mat = materials.at(i);

         if (loadTextures) {
            glActiveTexture(GL_TEXTURE1);
            glBindTexture(GL_TEXTURE_2D, loaded_textures[mtlDir + mat.diffuse_texname]);
            shader.setInt("material.diffuse", 1);

            glActiveTexture(GL_TEXTURE2);
            glBindTexture(GL_TEXTURE_2D, loaded_textures[mtlDir + mat.specular_texname]);
            shader.setInt("material.specular", 2);
            
            shader.setBool("hasOpacityMask", !mat.alpha_texname.empty());
            if (!mat.alpha_texname.empty()) {
               // use diffuse texture since there is actually no alpha texture file
               glActiveTexture(GL_TEXTURE3);
               glBindTexture(GL_TEXTURE_2D, loaded_textures[mtlDir + mat.diffuse_texname]);
               shader.setInt("material.alpha",3);
            }

         } else {
            shader.setInt("material.diffuse", 0);
            shader.setInt("material.specular", 0);
            shader.setInt("material.alpha", 0);
         }

         // displacement map is actually normal map
         glActiveTexture(GL_TEXTURE4);
         glBindTexture(GL_TEXTURE_2D, loaded_textures[mtlDir + mat.displacement_texname]);
         shader.setInt("material.normal", 4);

         glDrawElements(GL_TRIANGLES, m.size, GL_UNSIGNED_INT, (void*)(m.startIndex * sizeof(int)));
      }
   }

   void renderGeometry() {
      glBindVertexArray(VAO);
      for (int i = 0; i < meshes.size(); i++) {
         Mesh m = meshes.at(i);

         glDrawElements(GL_TRIANGLES, m.size, GL_UNSIGNED_INT, (void*)(m.startIndex * sizeof(int)));
      }
   }

   private:
      std::string mtlDir;
      tinyobj::attrib_t attrib;
      std::vector<tinyobj::shape_t> shapes;
      std::vector<tinyobj::material_t> materials;
      std::map<std::string, GLuint> loaded_textures;
      std::vector<Vertex> vertices;
      std::vector<int> indices;
      std::vector<Mesh> meshes;
      unsigned int VAO, VBO, EBO;

      std::vector<Vertex> findTangentBitangent(std::vector<Vertex> vertices,
                                               std::vector<int> indices) {
         std::map<int, glm::vec3> accTangents;
         std::map<int, glm::vec3> accBitangents;

         // Initialize tangent and bitangent accumulators to zero for all vertices
         for (int i = 0; i < vertices.size(); ++i) {
            accTangents[i] = glm::vec3(0.0f);
            accBitangents[i] = glm::vec3(0.0f);
         }

         for (int i = 0; i < indices.size(); i += 3) {
            Vertex vert1 = vertices.at(indices[i]);
            Vertex vert2 = vertices.at(indices[i + 1]);
            Vertex vert3 = vertices.at(indices[i + 2]);
            float uv1[2] = {vert1.uv[0], vert1.uv[1]};
            float uv2[2] = {vert2.uv[0], vert2.uv[1]};
            float uv3[2] = {vert3.uv[0], vert3.uv[1]};
            float u1 = uv2[0] - uv1[0];
            float u2 = uv3[0] - uv1[0];
            float v1 = uv2[1] - uv1[1];
            float v2 = uv3[1] - uv1[1];
            glm::vec3 e1 = glm::vec3(vert2.position[0], vert2.position[1], vert2.position[2]) -
                           glm::vec3(vert1.position[0], vert1.position[1], vert1.position[2]);
            glm::vec3 e2 = glm::vec3(vert3.position[0], vert3.position[1], vert3.position[2]) -
                           glm::vec3(vert1.position[0], vert1.position[1], vert1.position[2]);
            float det = (u1 * v2 - v1 * u2);
            if (abs(det) < 0.0001) continue;
            float f = 1 / det;
            glm::mat2 inv = f * glm::mat2(v2, -v1, -u2, u1);
            glm::mat3x2 e;
            e[0][0] = e1.x;
            e[0][1] = e2.x;
            e[1][0] = e1.y;
            e[1][1] = e2.y;
            e[2][0] = e1.z;
            e[2][1] = e2.z;
            glm::mat3x2 result = inv * e;
            glm::vec3 tangent = glm::transpose(result)[0];
            glm::vec3 bitangent = glm::transpose(result)[1];
            // glm::vec3 tangent = (e1 * v2 - e2 * v1) / det;
            // glm::vec3 bitangent = (e2 * u1 - e1 * u2) / det;
            accTangents[indices[i]] += tangent;
            accTangents[indices[i + 1]] += tangent;
            accTangents[indices[i + 2]] += tangent;
            accBitangents[indices[i]] += bitangent;
            accBitangents[indices[i + 1]] += bitangent;
            accBitangents[indices[i + 2]] += bitangent;
         }

         for (int i = 0; i < vertices.size(); ++i) {
            glm::vec3 T = glm::normalize(accTangents[i]);
            glm::vec3 B = glm::normalize(accBitangents[i]);
            glm::vec3 N = glm::normalize(
                  glm::vec3(vertices[i].normal[0], vertices[i].normal[1], vertices[i].normal[2]));

            // Gram-Schmidt orthogonalization
            T = glm::normalize(T - glm::dot(T, N) * N);

            // Check for "handedness" (optional but good practice)
            // if (glm::dot(glm::cross(N, T), B) < 0.0f) {
            //    T *= -1.0f;
            // }

            // Store the final vectors in the vertex data
            vertices.at(i).tangent[0] = T.x;
            vertices.at(i).tangent[1] = T.y;
            vertices.at(i).tangent[2] = T.z;
            vertices.at(i).bitangent[0] = B.x;
            vertices.at(i).bitangent[1] = B.y;
            vertices.at(i).bitangent[2] = B.z;
         }
         return vertices;
      }

      std::tuple<unsigned int, unsigned int, unsigned int> buildVAO(std::vector<Vertex> vertices,
                                                                    std::vector<int> indices) {
         unsigned int VBO, VAO, EBO;
         glGenVertexArrays(1, &VAO);
         glGenBuffers(1, &VBO);
         glGenBuffers(1, &EBO);

         glBindVertexArray(VAO);

         glBindBuffer(GL_ARRAY_BUFFER, VBO);
         glBufferData(GL_ARRAY_BUFFER, vertices.size() * sizeof(Vertex), vertices.data(),
                      GL_STATIC_DRAW);

         glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, EBO);
         glBufferData(GL_ELEMENT_ARRAY_BUFFER, indices.size() * sizeof(int), indices.data(),
                      GL_STATIC_DRAW);

         // vertex position
         glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 14 * sizeof(float), (void*)0);
         glEnableVertexAttribArray(0);

         // normal
         glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 14 * sizeof(float),
                               (void*)(3 * sizeof(float)));
         glEnableVertexAttribArray(1);

         // texture coordinates
         glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, 14 * sizeof(float),
                               (void*)(6 * sizeof(float)));
         glEnableVertexAttribArray(2);

         // tangent
         glVertexAttribPointer(3, 3, GL_FLOAT, GL_FALSE, 14 * sizeof(float),
                               (void*)(8 * sizeof(float)));
         glEnableVertexAttribArray(3);

         // bitangent
         glVertexAttribPointer(4, 3, GL_FLOAT, GL_FALSE, 14 * sizeof(float),
                               (void*)(11 * sizeof(float)));
         glEnableVertexAttribArray(4);
         return {VAO, VBO, EBO};
      }

      std::tuple<std::vector<Vertex>, std::vector<Mesh>, std::vector<int>> buildMeshes() {
         std::vector<Vertex> vertices;
         std::map<Vertex, int> vertexMap;
         std::vector<int> indices;
         std::vector<Mesh> meshes;
         int startIndex = 0;
         std::map<int, std::vector<tinyobj::index_t>> materialGroup = groupVerticesByMaterial();

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

               Vertex v = {
                     {position[0], position[1], position[2]},
                     {normal[0], normal[1], normal[2]},
                     {uv[0], uv[1]},
                     {0, 0, 0}, // tangent placeholder
                     {0, 0, 0}  // bitangent placeholder
               };
               if (vertexMap.count(v) == 0) {
                  vertexMap[v] = vertices.size();
                  vertices.push_back(v);
               }
               indices.push_back(vertexMap[v]);
            }
            startIndex += m_indices.size();
            currentMesh.size = m_indices.size();
            meshes.push_back(currentMesh);
         }
         return {vertices, meshes, indices};
      }

      std::set<std::string> uniqueTexturePathsSet() {
         std::set<std::string> tex_paths;

         // construct texture names set
         for (const auto& mat : materials) {
            std::cout << mat.name << "\n";
            if (!mat.diffuse_texname.empty()) {
               std::cout << "diffuse: " << mat.diffuse_texname << "\n";
               tex_paths.insert(mtlDir + mat.diffuse_texname);
            }
            if (!mat.specular_texname.empty()) {
               std::cout << "specular: " << mat.specular_texname << "\n";
               tex_paths.insert(mtlDir + mat.specular_texname);
            }
            if (!mat.alpha_texname.empty()) {
               std::cout << "alpha: " << mat.alpha_texname << "\n";
               tex_paths.insert(mtlDir + mat.alpha_texname);
            }
            if (!mat.displacement_texname.empty()) {
               std::cout << "displacement: " << mat.displacement_texname << "\n";
               tex_paths.insert(mtlDir + mat.displacement_texname);
            }
            std::cout << "\n";
         }

         return tex_paths;
      }

      GLuint loadTexture(std::string tex_path) {
         stbi_set_flip_vertically_on_load(true);
         GLuint textureID;
         glGenTextures(1, &textureID);
         glBindTexture(GL_TEXTURE_2D, textureID);
         int width, height, channels;
         unsigned char* data = stbi_load((tex_path).c_str(), &width, &height, &channels, 0);
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

         return textureID;
      }

      std::map<std::string, GLuint> loadTextures(std::set<std::string> tex_paths) {
         std::map<std::string, GLuint> loaded_textures;
         for (const std::string tex_path : tex_paths) {
            if (!loaded_textures.contains(tex_path)) {
               loaded_textures[tex_path] = loadTexture(tex_path);
            }
         }
         return loaded_textures;
      }

      std::map<int, std::vector<tinyobj::index_t>> groupVerticesByMaterial() {
         std::map<int, std::vector<tinyobj::index_t>> materialGroup;
         for (const auto& currentShape : shapes) {
            tinyobj::mesh_t currentMesh = currentShape.mesh;
            for (int j = 0; j + 2 < currentMesh.indices.size(); j += 3) {
               int currentMaterialID = currentMesh.material_ids.at(j / 3);
               materialGroup[currentMaterialID].push_back(currentMesh.indices.at(j));
               materialGroup[currentMaterialID].push_back(currentMesh.indices.at(j + 1));
               materialGroup[currentMaterialID].push_back(currentMesh.indices.at(j + 2));
            }
         }
         return materialGroup;
      }
   };
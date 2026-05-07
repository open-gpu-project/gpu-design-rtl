#pragma once 
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

struct Uniform {

};
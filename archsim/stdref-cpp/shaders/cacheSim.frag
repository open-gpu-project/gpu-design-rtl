#version 330 core
layout(location=0) out uint  outID;  // matches GL_R32UI
layout(location=1) out vec2  outUV;  // matches GL_RG32F

struct Material {
   int diffuse;
};
  
in vec2 TexCoords;

uniform Material material;

void main() {
    outID = uint(material.diffuse);     // your computed integer
    outUV = TexCoords;      // your UV in [0,1]
}
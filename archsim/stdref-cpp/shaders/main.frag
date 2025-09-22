#version 330 core
out vec4 FragColor;
  
in vec3 Normal;
in vec2 TexCoords;
in vec3 FragPos;
in vec4 vFragPosLight;
in mat3 TBN;

struct Material {
   sampler2D diffuse;
   sampler2D specular;
   sampler2D alpha;
   sampler2D normal;
   float shininess;
};

struct Light {
   vec3 position;  
   vec3 direction;
  
   vec3 ambient;
   vec3 diffuse;
   vec3 specular;
	
   float constant;
   float linear;
   float quadratic;
};

uniform vec3 lightColor;
uniform vec3 viewPos;
uniform Material material;
uniform Light light; 
uniform float lightIntensity;
uniform bool hasOpacityMask;
uniform bool blinn;
uniform int lightType;
uniform sampler2D depthMap;

uniform samplerCube cubeDepthMap;
uniform float far_plane;

float ShadowFactor(vec4 fragPosLight)
{
    // transform from clip to texture space
    vec3 p = fragPosLight.xyz / fragPosLight.w;     // NDC
    p = p * 0.5 + 0.5;                               // [0,1]
    // if outside the light’s frustum → treat as lit
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 0.0;

    float closest = texture(depthMap, p.xy).r;       // depth from light
    float current = p.z;                              // our depth

    // depth bias to avoid acne; make it slope-aware if you have the normal
    float bias = 0.00055;                             
   //  return current - bias > closest ? 1.0 : 0.0;     // 1 = shadow, 0 = lit
      // PCF
    float shadow = 0.0;
    vec2 texelSize = 1.0 / textureSize(depthMap, 0);
    for(int x = -1; x <= 1; ++x)
    {
        for(int y = -1; y <= 1; ++y)
        {
            float pcfDepth = texture(depthMap, p.xy + vec2(x, y) * texelSize).r; 
            shadow += current - bias > pcfDepth  ? 1.0 : 0.0;        
        }    
    }
    shadow /= 9.0;
    
    // keep the shadow at 0.0 when outside the far_plane region of the light's frustum.
    if(p.z > 1.0)
        shadow = 0.0;
        
    return shadow;
}

float ShadowCalculation(vec3 fragPos)
{
    // get vector between fragment position and light position
    vec3 fragToLight = fragPos - light.position;
    // ise the fragment to light vector to sample from the depth map    
    float closestDepth = texture(cubeDepthMap, fragToLight).r;
    // it is currently in linear range between [0,1], let's re-transform it back to original depth value
    closestDepth *= far_plane;
    // now get current linear depth as the length between the fragment and light position
    float currentDepth = length(fragToLight);
    // test for shadows
    float bias = 1; // we use a much larger bias since depth is now in [near_plane, far_plane] range
    float shadow = currentDepth -  bias > closestDepth ? 1.0 : 0.0;        
    // display closestDepth as debug (to visualize depth cubemap)
   //  FragColor = vec4(vec3(closestDepth / far_plane), 1.0);    
        
    return shadow;
}
void main() {
    if (lightType == 0){
        // alpha
        float alpha = 1.0;
      //   if (hasOpacityMask) {
            alpha = texture(material.diffuse, TexCoords).a;
      //   }
        if (alpha < 0.5)
        discard;
        // no lighting, just texture
        FragColor = vec4(pow(texture(material.diffuse, TexCoords).rgb, vec3(2.2)),1.0f);

    } else if (lightType == 1 || lightType == 2){
        vec3 n = texture(material.normal, TexCoords).rgb;
        vec3 norm = normalize(TBN * normalize(n * 2.0 - 1.0));   // this normal is in tangent space
        //normal = normalize(Normal);               // use interpolated normal instead of normal map
      //   vec3 norm = normalize(Normal);
        vec3 lightDir;

        if (lightType == 1){
            lightDir = normalize(light.position - FragPos);
        } else {
            lightDir = normalize(-light.direction);
        }

        // diffuse
        float diff = max(dot(norm,lightDir), 0.0f);

        // specular
        vec3 viewDir = normalize(viewPos-FragPos);
        vec3 reflectDir = reflect(-lightDir, norm);
        float spec = 0.0f;
        if (blinn){
            vec3 halfwayVec = normalize(viewDir + lightDir);
            spec = pow(max(dot(halfwayVec, norm),0.0),material.shininess);
        } else {
            spec = pow(max(dot(viewDir, reflectDir),0.0),material.shininess);
        }

        // alpha
        float alpha = 1.0;
      //   if (hasOpacityMask) {
            alpha = texture(material.diffuse, TexCoords).a;
      //   }
        if (alpha < 0.9)
        discard;

         float gamma = 2.2;
        // results of each component
        vec3 ambient  = lightIntensity * lightColor  * pow(texture(material.diffuse, TexCoords).rgb, vec3(gamma));
        vec3 diffuse  = lightIntensity * lightColor  * diff * pow(texture(material.diffuse, TexCoords).rgb, vec3(gamma));
        vec3 specular = lightIntensity * lightColor * spec * vec3(texture(material.specular, TexCoords));

        // attenuation
        float distance = length(light.position - FragPos);
        float attenuation = 1.0 / (light.constant + light.linear * distance + light.quadratic * (distance * distance));    

        if (lightType == 1){
            ambient *= attenuation;
            diffuse *= attenuation;
            specular *= attenuation;
            float shadow = ShadowCalculation(FragPos);
            diffuse  *= (1.0 - shadow);
            specular *= (1.0 - shadow);             
        }

        if (lightType == 2){
            float shadow = ShadowFactor(vFragPosLight);
            diffuse  *= (1.0 - shadow);
            specular *= (1.0 - shadow);   
        }

      //   results
        FragColor = vec4(ambient + diffuse + specular, alpha); 
    }
}
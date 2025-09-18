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
    float bias = 0.015;                             
   //  return current - bias > closest ? 1.0 : 0.0;     // 1 = shadow, 0 = lit
      // PCF
    float shadow = 0.0;
    vec2 texelSize = 1.0 / textureSize(depthMap, 0);
    for(int x = -2; x <= 2; ++x)
    {
        for(int y = -2; y <= 2; ++y)
        {
            float pcfDepth = texture(depthMap, p.xy + vec2(x, y) * texelSize).r; 
            shadow += current - bias > pcfDepth  ? 1.0 : 0.0;        
        }    
    }
    shadow /= 25.0;
    
    // keep the shadow at 0.0 when outside the far_plane region of the light's frustum.
    if(p.z > 1.0)
        shadow = 0.0;
        
    return shadow;
}

void main() {
    if (lightType == 0){
        // alpha
        float alpha = 1.0;
        if (hasOpacityMask) {
            alpha = texture(material.diffuse, TexCoords).a;
        }
        if (alpha < 0.5)
        discard;

        // no lighting, just texture
        FragColor = texture(material.normal, TexCoords);
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
        if (hasOpacityMask) {
            alpha = texture(material.alpha, TexCoords).a;
        }
        if (alpha < 0.9)
        discard;

        // results of each component
        vec3 ambient  = lightIntensity * lightColor  * vec3(texture(material.diffuse, TexCoords));
        vec3 diffuse  = lightIntensity * lightColor  * diff * vec3(texture(material.diffuse, TexCoords));  
        vec3 specular = lightIntensity * lightColor * spec * vec3(texture(material.specular, TexCoords));

        // attenuation
        float distance = length(light.position - FragPos);
        float attenuation = 1.0 / (light.constant + light.linear * distance + light.quadratic * (distance * distance));    

        if (lightType == 1){
            ambient *= attenuation;
            diffuse *= attenuation;
            specular *= attenuation;
        }

        if (lightType == 2){
            float shadow = ShadowFactor(vFragPosLight);
            diffuse  *= (1.0 - shadow);
            specular *= (1.0 - shadow);   
        }

        // results
        FragColor = vec4(ambient + diffuse + specular, alpha); 
    }
}
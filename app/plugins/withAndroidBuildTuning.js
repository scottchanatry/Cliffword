/**
 * Android build tuning for EAS (see app/README.md, "Native code and EAS").
 *
 * llama.rn 0.13.0-rc.11 builds llama.cpp from source (its gradle.properties forces
 * rnllamaBuildFromSource=true) once per CPU variant, and every native library is built for
 * four ABIs by default. Together that ran past the 45-minute EAS build limit. This plugin
 * writes Gradle properties into android/gradle.properties at prebuild:
 *
 * - reactNativeArchitectures=arm64-v8a: the 1.1 GB model needs a 64-bit ARM phone, so 32-bit
 *   and x86 builds are dead weight (x86_64 only serves emulators).
 * - rnllamaVariants: the llama.rn variants to compile. "rnllama" is the generic core that
 *   RNLlama.java always loads; rnllama_v8_2_dotprod covers ARMv8.2+ phones (2018 on) and
 *   rnllama_v8_2_dotprod_i8mm the ARMv8.6+ ones. Older cores fall back to the generic build.
 *
 * Options: { properties: { [key]: string } } replaces or adds each property.
 */
const { withGradleProperties } = require('expo/config-plugins');

function withAndroidBuildTuning(config, options = {}) {
  const properties = options.properties || {};
  return withGradleProperties(config, (c) => {
    for (const [key, value] of Object.entries(properties)) {
      c.modResults = c.modResults.filter((item) => !(item.type === 'property' && item.key === key));
      c.modResults.push({ type: 'property', key, value: String(value) });
    }
    return c;
  });
}

module.exports = withAndroidBuildTuning;

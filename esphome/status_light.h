#pragma once

// Helpers shared by the status-light scripts in cartridge-reader.yaml.
//
// Kept out of the YAML so they are defined once rather than pasted into every
// lambda, and so the RGB-versus-RGBW question is answered in exactly one place.
//
// No namespace: ESPHome compiles lambdas inside its own, and qualifying every
// call site made the scripts harder to read than the prefix does.

#include "esphome/components/light/light_call.h"
#include "esphome/components/light/light_state.h"

/// True when the strip has a dedicated white die, i.e. `type` contains a W.
inline bool status_has_white_die(esphome::light::LightState *led) {
  return led->get_traits().supports_color_mode(esphome::light::ColorMode::RGB_WHITE);
}

/// A colour.
///
/// Explicitly extinguishes the white die. Without this, a colour set after a
/// white state inherits the lit white die and comes out pastel — an error that
/// should be red arrives pink, which reads as a hardware fault rather than a
/// status. Every state has to say something about white, including the ones
/// that want none of it.
inline void status_paint_color(esphome::light::LightCall &call, float r, float g, float b) {
  call.set_rgb(r, g, b);
  call.set_white_if_supported(0.0f);
}

/// White, from whichever source the part actually has.
///
/// On a four-die part this is the white die alone. Mixing R+G+B on one of those
/// gives the faintly iridescent "white" that gives cheap light strips away: the
/// three dies sit beside each other rather than in one package, so the colour
/// shifts with viewing angle and never quite lands on neutral. The white die
/// exists precisely to avoid that. A three-die part has no such die and has to
/// mix, which is the only reason this branch exists.
///
/// Asking the light which it is — rather than a second setting next to `type` —
/// means changing `type` moves everything with it, and the two cannot disagree.
inline void status_paint_white(esphome::light::LightState *led,
                               esphome::light::LightCall &call, float brightness) {
  if (status_has_white_die(led)) {
    call.set_rgb(0.0f, 0.0f, 0.0f);
    call.set_white(1.0f);
  } else {
    call.set_rgb(1.0f, 1.0f, 1.0f);
  }
  call.set_brightness(brightness);
}

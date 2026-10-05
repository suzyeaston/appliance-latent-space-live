# Web MIDI bridge

The browser UI, computer keyboard, USB MIDI controller and future toaster all converge on the same semantic control events. The toaster does **not** become the audio computer. The Mac remains the audio/visual host.

## Current map

Channel 1:

| MIDI | Control |
| --- | --- |
| CC 21 | browning |
| CC 22 | destruction |
| CC 23 | latent x (currently disabled) |
| CC 24 | latent y (currently disabled) |
| CC 25 | neural mix (currently disabled) |
| CC 26 | memory |
| Note 36 | plunge |
| Note 37 | capture |
| Note 38 | freeze |
| Note 39 | kill |

## Keystation Mini 32 MK3 test

1. Use a current Chrome browser on macOS.
2. Plug the Keystation in by USB.
3. Open the instrument and press **Connect MIDI**.
4. Keep the keyboard on MIDI channel 1.
5. Test notes 36–39. If the physical keys are in another octave, use the keyboard's octave controls.
6. The Keystation volume knob defaults to CC 7, so assign the knob to **CC 26** first for a very visible/audible test of `memory`.
7. Then assign the knob to **CC 21** to prototype the future toaster browning dial.

The important first test is not “does every piano key play a synth?”

It is: **can a physical gesture reliably become the exact same semantic event the browser already understands?**

That gives the ESP32 toaster a stable target.

## Toaster path

```text
physical toaster gesture
        ↓
safe low-voltage sensor
        ↓
ESP32
        ↓
BLE MIDI
        ↓
macOS MIDI
        ↓
Web MIDI bridge
        ↓
semantic control event
        ↓
audio + visuals
```

Keep USB MIDI as the rehearsal fallback.

For the physical build, use a decommissioned toaster shell or otherwise make the appliance permanently unable to energize its heating circuit before adding electronics. The performance object should be a controller, not a live mains-powered toaster.

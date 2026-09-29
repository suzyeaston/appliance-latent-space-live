# SUZY//AI integration

The Appliance remains the instrument.

SUZY//AI becomes the optional local intelligence and memory layer.

```text
toaster hardware
    ↓ Bluetooth
logical control events
    ↓
The Appliance on the computer
    ↓
audio + visuals
    │
    └── explicit Teach action → SUZY//AI
```

The toaster does not need to host the model.

## Teaching music

```http
POST http://127.0.0.1:7331/v1/teach/music
```

Example:

```json
{
  "idea": "Am(add9) with open E",
  "voicing": "x02400",
  "instrument": "guitar",
  "influences": ["artist / album / memory"],
  "why": "the suspension is the thing I care about",
  "avoid": "do not flatten this into a major/minor emotion label",
  "connections": ["another voicing", "song", "texture"],
  "source": "appliance-latent-space"
}
```

Exact repeats are deduplicated. Changed teachings survive as history.

The instrument must remain playable when SUZY//AI is offline.

A future interface may add an explicit **Teach SUZY//AI** action beside a phrase, scene, chord, or accepted variation. Do not silently train from every gesture.

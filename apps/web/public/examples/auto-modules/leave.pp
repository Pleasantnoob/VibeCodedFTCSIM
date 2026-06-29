{
  "startPoint": {
    "x": 40,
    "y": 108,
    "heading": "constant",
    "degrees": 134,
    "locked": false
  },
  "lines": [
    {
      "id": "leave-line",
      "name": "Leave launch zone",
      "endPoint": {
        "x": 23,
        "y": 122,
        "heading": "constant",
        "degrees": 180,
        "reverse": false
      },
      "controlPoints": [
        { "x": 18, "y": 115 }
      ],
      "waitBeforeMs": 0,
      "waitAfterMs": 0
    }
  ],
  "sequence": [
    { "kind": "path", "lineId": "leave-line" }
  ],
  "version": "1.2.1"
}

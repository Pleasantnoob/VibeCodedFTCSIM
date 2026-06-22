{
  "startPoint": {
    "x": 23,
    "y": 122,
    "heading": "linear",
    "startDeg": 90,
    "endDeg": 180,
    "locked": false
  },
  "lines": [
    {
      "id": "mkuil5a7-qkbe5n",
      "name": "Path 10",
      "endPoint": {
        "x": 60,
        "y": 84,
        "heading": "linear",
        "reverse": false,
        "degrees": 180,
        "startDeg": 134,
        "endDeg": 134
      },
      "controlPoints": [],
      "color": "#D67C8D",
      "waitBeforeMs": 0,
      "waitAfterMs": 0,
      "waitBeforeName": "",
      "waitAfterName": ""
    },
    {
      "id": "mqnmgpk9-mpraqo",
      "name": "Path 2",
      "endPoint": {
        "x": 17,
        "y": 84,
        "heading": "linear",
        "reverse": false,
        "startDeg": 134,
        "endDeg": 180
      },
      "controlPoints": [],
      "color": "#5C6A6A",
      "waitBeforeMs": 0,
      "waitAfterMs": 0,
      "waitBeforeName": "",
      "waitAfterName": ""
    },
    {
      "id": "mqnmhl3l-qg9syt",
      "name": "Path 3",
      "endPoint": {
        "x": 40,
        "y": 105,
        "heading": "linear",
        "reverse": false,
        "startDeg": 180,
        "endDeg": 134
      },
      "controlPoints": [],
      "color": "#8C95DD",
      "waitBeforeMs": 0,
      "waitAfterMs": 0,
      "waitBeforeName": "",
      "waitAfterName": ""
    },
    {
      "id": "mqnmik77-i3i9h5",
      "name": "Path 4",
      "endPoint": {
        "x": 17,
        "y": 84,
        "heading": "linear",
        "reverse": false,
        "startDeg": 134,
        "endDeg": 180
      },
      "controlPoints": [],
      "color": "#66CD5C",
      "waitBeforeMs": 0,
      "waitAfterMs": 0,
      "waitBeforeName": "",
      "waitAfterName": ""
    }
  ],
  "shapes": [
    {
      "id": "triangle-1",
      "name": "Red Goal",
      "vertices": [
        {
          "x": 144,
          "y": 70
        },
        {
          "x": 144,
          "y": 144
        },
        {
          "x": 120,
          "y": 144
        },
        {
          "x": 138,
          "y": 119
        },
        {
          "x": 138,
          "y": 70
        }
      ],
      "color": "#dc2626",
      "fillColor": "#ff6b6b"
    },
    {
      "id": "triangle-2",
      "name": "Blue Goal",
      "vertices": [
        {
          "x": 7,
          "y": 118
        },
        {
          "x": 25,
          "y": 144
        },
        {
          "x": 0,
          "y": 144
        },
        {
          "x": 0,
          "y": 70
        },
        {
          "x": 7,
          "y": 70
        }
      ],
      "color": "#2563eb",
      "fillColor": "#60a5fa"
    }
  ],
  "sequence": [
    {
      "kind": "path",
      "lineId": "mkuil5a7-qkbe5n"
    },
    {
      "kind": "wait",
      "id": "mqnmg88h-y92d7o",
      "name": "Wait",
      "durationMs": 1000,
      "locked": false
    },
    {
      "kind": "path",
      "lineId": "mqnmgpk9-mpraqo"
    },
    {
      "kind": "path",
      "lineId": "mqnmhl3l-qg9syt"
    },
    {
      "kind": "wait",
      "id": "mqnmi6rw-74v6bb",
      "name": "Wait",
      "durationMs": 1000,
      "locked": false
    },
    {
      "kind": "path",
      "lineId": "mqnmik77-i3i9h5"
    }
  ],
  "settings": {
    "xVelocity": 72.39374,
    "yVelocity": 57.32301,
    "aVelocity": 3.141592653589793,
    "kFriction": 0.1,
    "rWidth": 18,
    "rHeight": 18,
    "safetyMargin": 1,
    "maxVelocity": 50,
    "maxAcceleration": 40,
    "maxDeceleration": 30,
    "fieldMap": "decode.webp",
    "robotImage": "/robot.png",
    "theme": "auto",
    "showGhostPaths": false,
    "showOnionLayers": false,
    "onionLayerSpacing": 3,
    "onionColor": "#dc2626",
    "onionNextPointOnly": false
  },
  "version": "1.2.1",
  "timestamp": "2026-06-21T10:08:44.636Z"
}
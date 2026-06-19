{
  "startPoint": {
    "x": 57,
    "y": 9,
    "heading": "linear",
    "startDeg": 90,
    "endDeg": 180,
    "locked": false
  },
  "lines": [
    {
      "id": "line-r003rcnr7yq",
      "name": "Path 1",
      "endPoint": {
        "x": 57,
        "y": 36,
        "heading": "linear",
        "startDeg": 90,
        "endDeg": 180
      },
      "controlPoints": [],
      "color": "#6BD95C",
      "locked": false,
      "waitBeforeMs": 0,
      "waitAfterMs": 0,
      "waitBeforeName": "",
      "waitAfterName": ""
    },
    {
      "id": "mqkf7u21-ccuhsm",
      "name": "Path 2",
      "endPoint": {
        "x": 12,
        "y": 36,
        "heading": "tangential",
        "reverse": false
      },
      "controlPoints": [],
      "color": "#6BD9D7",
      "waitBeforeMs": 0,
      "waitAfterMs": 0,
      "waitBeforeName": "",
      "waitAfterName": ""
    },
    {
      "id": "mqkf86yh-sz8b0h",
      "name": "Path 3",
      "endPoint": {
        "x": 60,
        "y": 18,
        "heading": "linear",
        "reverse": false,
        "startDeg": 180,
        "endDeg": 114
      },
      "controlPoints": [],
      "color": "#C6D896",
      "waitBeforeMs": 0,
      "waitAfterMs": 0,
      "waitBeforeName": "",
      "waitAfterName": ""
    },
    {
      "id": "mqkgoyh5-h1undu",
      "name": "Path 4",
      "endPoint": {
        "x": 60,
        "y": 60,
        "heading": "linear",
        "reverse": false,
        "startDeg": 114,
        "endDeg": 180
      },
      "controlPoints": [],
      "color": "#DCA95C",
      "waitBeforeMs": 0,
      "waitAfterMs": 0,
      "waitBeforeName": "",
      "waitAfterName": ""
    },
    {
      "id": "mqkgpflc-c0ry3l",
      "name": "Path 5",
      "endPoint": {
        "x": 12,
        "y": 60,
        "heading": "tangential",
        "reverse": false
      },
      "controlPoints": [],
      "color": "#C96BB6",
      "waitBeforeMs": 0,
      "waitAfterMs": 0,
      "waitBeforeName": "",
      "waitAfterName": ""
    },
    {
      "id": "mqkgpmcy-hcu4dp",
      "name": "Path 6",
      "endPoint": {
        "x": 60,
        "y": 18,
        "heading": "linear",
        "reverse": false,
        "startDeg": 180,
        "endDeg": 114
      },
      "controlPoints": [],
      "color": "#CD6CD7",
      "waitBeforeMs": 0,
      "waitAfterMs": 0,
      "waitBeforeName": "",
      "waitAfterName": ""
    },
    {
      "id": "mqkgwv0d-1zz38o",
      "name": "Path 7",
      "endPoint": {
        "x": 60,
        "y": 84,
        "heading": "linear",
        "reverse": false,
        "startDeg": 114,
        "endDeg": 180
      },
      "controlPoints": [],
      "color": "#999BDB",
      "waitBeforeMs": 0,
      "waitAfterMs": 0,
      "waitBeforeName": "",
      "waitAfterName": ""
    },
    {
      "id": "mqkgwzfw-12enj9",
      "name": "Path 8",
      "endPoint": {
        "x": 15,
        "y": 84,
        "heading": "tangential",
        "reverse": false
      },
      "controlPoints": [],
      "color": "#B97BB5",
      "waitBeforeMs": 0,
      "waitAfterMs": 0,
      "waitBeforeName": "",
      "waitAfterName": ""
    },
    {
      "id": "mqkgylfj-h0sm2y",
      "name": "Path 9",
      "endPoint": {
        "x": 60,
        "y": 18,
        "heading": "linear",
        "reverse": false,
        "startDeg": 180,
        "endDeg": 114
      },
      "controlPoints": [],
      "color": "#7B58D7",
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
          "x": 6,
          "y": 119
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
      "lineId": "line-r003rcnr7yq"
    },
    {
      "kind": "path",
      "lineId": "mqkf7u21-ccuhsm"
    },
    {
      "kind": "path",
      "lineId": "mqkf86yh-sz8b0h"
    },
    {
      "kind": "wait",
      "id": "mqkgkkh1-6o96wf",
      "name": "Wait",
      "durationMs": 2000,
      "locked": false
    },
    {
      "kind": "path",
      "lineId": "mqkgoyh5-h1undu"
    },
    {
      "kind": "path",
      "lineId": "mqkgpflc-c0ry3l"
    },
    {
      "kind": "path",
      "lineId": "mqkgpmcy-hcu4dp"
    },
    {
      "kind": "wait",
      "id": "mqkgq47p-n5uuwo",
      "name": "Wait",
      "durationMs": 2000,
      "locked": false
    },
    {
      "kind": "path",
      "lineId": "mqkgwv0d-1zz38o"
    },
    {
      "kind": "path",
      "lineId": "mqkgwzfw-12enj9"
    },
    {
      "kind": "path",
      "lineId": "mqkgylfj-h0sm2y"
    },
    {
      "kind": "wait",
      "id": "mqkgyy5d-0vqncz",
      "name": "Wait",
      "durationMs": 2000,
      "locked": false
    }
  ],
  "settings": {
    "xVelocity": 75,
    "yVelocity": 65,
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
  "timestamp": "2026-06-19T05:10:29.360Z"
}
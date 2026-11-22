# 3D Viewer

Open a CAD file in your browser and measure it. No install, no account, no upload: the file never leaves your computer.

![3D Viewer with the example bracket loaded](docs/images/viewer-overview.png)

## What it does

- Opens **STEP, IGES, BREP, STL and 3MF** files by drag and drop
- Shows overall size, volume, surface area, centroid and mass
- Measures distances, angles, edge lengths, radii and hole diameters
- Cuts a section through the model along X, Y or Z
- Lists the parts of an assembly so you can hide the ones in the way

![Measuring the diameter of the centre hole](docs/images/diameter-measurement.png)

## Try it

```sh
git clone https://github.com/EymenSaitogluGumus/3D_Viewer.git
cd 3D_Viewer
python3 -m http.server 8000
```

Then open <http://localhost:8000>. An example bracket loads on start. Drop your own file on the page, or click **Open file…**.

Opening `index.html` directly by double-clicking will not work. The page has to be served over HTTP, and any static server will do.

## Shortcuts

| Key | Action |
| --- | --- |
| Left drag | Rotate |
| Right drag | Pan |
| Scroll | Zoom |
| `I` | Isometric view |
| `1` to `6` | Front, back, left, right, top, bottom |
| `F` | Fit to view |
| `E` | Edges on or off |
| `W` | Wireframe |
| `O` | Orthographic or perspective |
| `M` | Measure |
| `Esc` | Clear the measurement |

While measuring, hold `Shift` to pick any point instead of snapping to a feature.

## Good to know

- All values are in millimetres. STL files carry no units, so they are read as millimetres.
- Numbers are computed from the triangle mesh, so they are close approximations, not exact CAD values. Set **Mesh quality** to Fine for tighter results.
- Volume and mass are only meaningful for closed solids.

## Built with

[three.js](https://threejs.org/) for rendering, [occt-import-js](https://github.com/kovacsv/occt-import-js) for reading STEP, IGES and BREP, and [fflate](https://github.com/101arrowz/fflate) for unpacking 3MF. All three are bundled in this repository, so there is nothing to install or build.

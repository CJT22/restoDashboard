# Restaurant Dashboard

A modern, high-contrast restaurant management dashboard inspired by high-end smart-venue displays. It enables restaurant staff, hosts, and kitchen expediters to monitor table/room bookings across multiple floors, inspect individual table orders, track single-dish pending vs. served states in real-time, and customize floor layout pins with drag-and-drop placement over custom 1774 × 887 PNG architectural floor plans.

---

## 🚀 Getting Started (Run Locally on Your Machine)

Follow these simple steps if you download this project as a ZIP archive from AI Studio or GitHub:

### 1. Prerequisites
Ensure you have **Node.js** installed on your computer:
- **Node.js**: Version 18.0.0 or higher is recommended.
  - Download from: [nodejs.org](https://nodejs.org/) (Choose the LTS version)
- **npm**: Comes bundled with Node.js automatically.

---

### 2. Step-by-Step Installation & Run

#### Step 1: Extract the ZIP Folder
1. Locate the downloaded `.zip` file on your computer.
2. Right-click and choose **Extract All...** (Windows) or double-click to unzip (macOS/Linux).
3. Open the newly extracted folder containing `package.json`, `src/`, `vite.config.ts`, etc.

#### Step 2: Open in Your IDE
1. Launch your preferred code editor (e.g., **Visual Studio Code**, **Cursor**, **WebStorm**).
2. Click **File** > **Open Folder...** and select the extracted project directory.

#### Step 3: Open an Integrated Terminal
In VS Code, press:
- `Ctrl + \`` (Windows/Linux) or `Cmd + \`` (macOS)
- Or go to the top menu: **Terminal** > **New Terminal**.

#### Step 4: Install Dependencies
In the terminal, run:
```bash
npm install
```
*This downloads all required packages (React, Tailwind CSS, Lucide icons, Vite, etc.) into a `node_modules/` folder.*

#### Step 5: Start the Local Development Server
In the terminal, run:
```bash
npm run dev
```

#### Step 6: Open the Dashboard in Your Browser
Once the dev server starts, it will output a local URL:
```
  VITE v5.x.x  ready in 200 ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
```
Hold `Ctrl` (or `Cmd`) and click the link, or open your web browser and navigate to:
👉 **`http://localhost:3000`**

---

## 🛠️ Available Scripts

In the project directory, you can run:

| Command | Description |
| :--- | :--- |
| `npm run dev` | Runs the app in development mode with live preview. |
| `npm run build` | Compiles and bundles production-ready static assets into the `dist/` folder. |
| `npm run preview` | Locally serves the production build from `dist/` to verify performance. |
| `npm run lint` | Runs TypeScript checks (`tsc --noEmit`) to validate types and catch syntax errors. |

---

## 📐 Floor Plan Image Specifications

- **Recommended Resolution:** **1774 × 887 pixels**
- **Format:** **PNG** (or JPG / WEBP)
- **Aspect Ratio:** **Exact 2:1 aspect ratio**. The interactive map container is engineered to this exact ratio, ensuring your custom PNG floor plan renders edge-to-edge without letterboxing, clipping, or stretching.
- **Upload:** Click **"+ Upload 1774×887 Plan"** at the bottom of the map or in the sidebar to upload floor plans for Floor 1 and Floor 2. Your uploaded images are saved locally in browser storage.

---

## 🎯 Key Features & How to Use

1. **Floor Switching**:
   - Use the **Active Floor** selector in the sidebar to toggle between **Floor 1 (Main Dining Area)** and **Floor 2 (KTV Rooms Area)**.

2. **Quick Control & Filter**:
   - **Available Pins (Emerald)**: Toggle to isolate and display only available tables/rooms.
   - **Occupied Pins (Amber)**: Toggle to view active tables with pending/served orders.
   - When both buttons are unselected (or both are toggled on), all tables/rooms appear normally.

3. **Edit Layout & Drag-and-Drop Pins**:
   - Click **"Edit Pins"** in the top bar or sidebar to enter layout editing mode.
   - **Move Existing Pins**: Simply click and drag any table pin to anywhere on the floor map. Releasing drops the pin at the new coordinates without triggering any popups.
   - **Place New Tables/Rooms**: Click on any empty space on the floor plan to open the table creation dialog. Enter the name (e.g., *"Table 14"*, *"KTV Room 2"*), short code, and seating capacity.
   - **Delete All Pins**: In Edit Mode, click **"Delete All Pins"** to clear the floor and start placing pins on a clean slate (includes a safe confirmation modal).

4. **Table Details & Order Management**:
   - When **Edit Mode** is off, click any table or room marker to open the detailed management panel.
   - Update table status (*Available*, *Occupied*, *Reserved*, *Needs Cleaning*).
   - View ordered dishes, add new items, and toggle individual dish statuses between **Pending** and **Served**, or click **"Mark All Served"**.

5. **Live Order Queue & Table Directory**:
   - Switch to **"Live Order Queue"** in the sidebar to see an expediter kitchen view of all awaiting dishes grouped by wait time.
   - Switch to **"All Tables & Rooms"** for a searchable list and table status breakdown.

---

## 📂 Project Structure

```text
├── index.html                      # HTML entry point with dark background & fonts
├── package.json                    # Dependencies and scripts
├── tsconfig.json                   # TypeScript compiler configuration
├── vite.config.ts                  # Vite build configuration (Port 3000)
├── README.md                       # Local setup and usage instructions
├── src/
│   ├── main.tsx                    # React DOM entry point
│   ├── App.tsx                     # Main layout, state persistence & modals
│   ├── index.css                   # Tailwind styles and custom scrollbars
│   ├── types.ts                    # Core TypeScript models (TableRoom, OrderItem, Status)
│   ├── config/
│   │   ├── layoutEditor.ts         # VITE_ENABLE_LAYOUT_EDITOR flag (editor is off by default)
│   │   └── zoomControls.ts         # VITE_ENABLE_ZOOM_CONTROLS flag (zoom buttons are off by default)
│   ├── data/
│   │   ├── floorLayout.json        # The fixed zone + info panel layout (source of truth)
│   │   └── floorLayout.ts          # Typed access to floorLayout.json
│   ├── layoutEditor/               # Dormant Edit Zones editor — see docs/layout-editor.md
│   └── components/
│       ├── Sidebar.tsx             # Clock, navigation, 2 quick filters, floor switch
│       ├── FloorPlanMap.tsx        # 16:9 interactive floor plan canvas
│       ├── TableDetailModal.tsx    # Modal to view table status, guests, & orders
│       ├── ConfirmModal.tsx        # Custom in-app confirmation dialog
│       ├── TableDirectoryView.tsx  # Searchable directory of all tables/rooms
│       ├── OrderQueueView.tsx      # Kitchen expediter view for pending dishes
│       └── CustomFloorPlanUploader.tsx # 1774×887 PNG image uploader
```

---

## 💡 Troubleshooting

- **Port already in use?**
  If port 3000 is occupied, you can change the port in `vite.config.ts` or run `npx vite --port 3001`.
- **Changing the floor layout:**
  Zones and info panels are fixed in `src/data/floorLayout.json`, and the Edit Zones editor is turned off.
  To re-lay out the floor, see [docs/layout-editor.md](../docs/layout-editor.md).
- **Zoom buttons:**
  The floor plan is fixed at its default size; the zoom in/out/reset buttons are turned off.
  To bring them back, see [docs/zoom-controls.md](../docs/zoom-controls.md).

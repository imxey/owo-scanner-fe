import { Suspense, lazy } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
// @ts-ignore - Importing directly for layout wrapping
import DashboardLayout from "./pages/dashboard/layout";

// Auto-import all files from ./pages
const pages = import.meta.glob("./pages/**/*.tsx");

const routes = Object.keys(pages)
  .map((path) => {
    // Ignore layouts and internal components
    if (path.includes("/layout.tsx") || path.includes("/components/"))
      return null;

    let name = path.replace(/^\.\/pages\//, "").replace(/\.tsx$/, "");

    // Handle Next.js style 'page.tsx' naming convention
    if (name.endsWith("/page")) {
      name = name.replace(/\/page$/, "");
    }

    // Map 'Home' or 'index' to root path
    if (name === "Home" || name === "index") {
      name = "";
    }

    const routePath = name ? `/${name.toLowerCase()}` : "/";
    const Component = lazy(pages[path] as any);

    return {
      path: routePath,
      Element: Component,
    };
  })
  .filter((r): r is { path: string; Element: React.LazyExoticComponent<any> } =>
    Boolean(r),
  );

function App() {
  return (
    <Router>
      <Suspense
        fallback={
          <div className="flex items-center justify-center min-h-screen">
            Loading...
          </div>
        }
      >
        <Routes>
          {routes.map((route) => {
            // Special handling: Wrap dashboard routes in DashboardLayout
            if (route.path.startsWith("/dashboard")) {
              return (
                <Route
                  key={route.path}
                  path={route.path}
                  element={
                    <DashboardLayout>
                      <route.Element />
                    </DashboardLayout>
                  }
                />
              );
            }
            return (
              <Route
                key={route.path}
                path={route.path}
                element={<route.Element />}
              />
            );
          })}
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;

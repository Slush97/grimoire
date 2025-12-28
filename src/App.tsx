import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Installed from './pages/Installed';
import Browse from './pages/Browse';
import Conflicts from './pages/Conflicts';
import Profiles from './pages/Profiles';
import Settings from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Installed />} />
          <Route path="browse" element={<Browse />} />
          <Route path="conflicts" element={<Conflicts />} />
          <Route path="profiles" element={<Profiles />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

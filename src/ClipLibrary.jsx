import { useState } from 'react';
import { clipRoles } from '../shared/podcast-editing.js';

export default function ClipLibrary({ assets, onAdd, disabled }) {
  const [source, setSource] = useState(''), [role, setRole] = useState('segment');
  const asset = assets.find(item => item.id === source);
  return <section className="card fields"><h3>Build your episode</h3><p className="small muted">Reuse an uploaded intro, add a musical transition between sections, or finish with your closing. Select music you have permission to publish.</p><label>Audio library<select className="field" aria-label="Audio library" value={source} onChange={e => setSource(e.target.value)}><option value="">Choose a recording or music track</option>{assets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Add as<select className="field" aria-label="Add as" value={role} onChange={e => setRole(e.target.value)}>{clipRoles.map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label><button className="btn primary" disabled={disabled || !asset} onClick={() => onAdd(asset, role)}>Add clip to episode</button><p className="small muted">Intros go first, closings go last, and musical transitions go after the selected clip. Transition clips start at five seconds with gentle fades; select one to adjust it.</p></section>;
}

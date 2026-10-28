"""Procedural Blender shot renderer for the video-engine.

This creates original, explicitly procedural 3D motion-graphics assets. It does
not claim to generate realistic AI assets or characters. Invocation:
 blender -b --python render_scene.py -- --visual TEXT --output DIR --duration SEC --fps N --width N --height N
"""
import bpy, math, os, sys, random, subprocess
from mathutils import Vector

def arg(name, default):
    args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    return args[args.index(name)+1] if name in args else default

visual = arg('--visual', 'technology product explainer')
output = os.path.abspath(arg('--output', 'blender-output'))
duration = max(1.0, min(12.0, float(arg('--duration','4'))))
fps = int(arg('--fps','24'))
width = int(arg('--width','960')); height = int(arg('--height','540'))
text = visual.strip()[:72]
os.makedirs(output, exist_ok=True)
random.seed(12)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.render.engine='BLENDER_EEVEE'
scene.eevee.taa_render_samples=16
scene.render.resolution_x=width; scene.render.resolution_y=height; scene.render.resolution_percentage=100
scene.render.fps=fps; scene.frame_start=1; scene.frame_end=max(2,round(duration*fps))
scene.render.image_settings.file_format='PNG'; scene.render.film_transparent=False
scene.world.color=(0.018,0.025,0.045)
scene.view_settings.view_transform='AgX'
scene.render.image_settings.color_mode='RGBA'

# Color-managed materials; emission makes diagram accents legible in Eevee.
def mat(name,color,metal=0,rough=.35,emission=None,strength=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=(*color,1); bs.inputs['Metallic'].default_value=metal; bs.inputs['Roughness'].default_value=rough
    if emission:
        bs.inputs['Emission Color'].default_value=(*emission,1); bs.inputs['Emission Strength'].default_value=strength
    return m
navy=mat('Midnight anodized alloy',(0.025,.06,.12),.8,.24)
blue=mat('Electric cyan',(0.02,.45,.8),.45,.25,(.01,.35,1),2.4)
gold=mat('Warm highlight',(.95,.42,.08),.45,.28,(1,.17,.015),1.4)
white=mat('Ivory lettering',(.8,.9,1),.15,.3,(.6,.8,1),.45)
floor_mat=mat('Studio floor',(.012,.019,.033),.55,.34)

def cube(name,loc,scale,material,bevel=.08):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc); o=bpy.context.object; o.name=name; o.dimensions=scale; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(material)
    if bevel:
        mod=o.modifiers.new('Machined edge highlights','BEVEL'); mod.width=bevel; mod.segments=3
        o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
    return o

def sphere(name,loc,r,material,segments=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=20, radius=r, location=loc); o=bpy.context.object; o.name=name; o.data.materials.append(material); bpy.ops.object.shade_smooth(); return o

def cylinder(name,loc,r,depth,material,vertices=48):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=r, depth=depth, location=loc); o=bpy.context.object; o.name=name; o.data.materials.append(material); o.modifiers.new('Soft machined edge','BEVEL').width=.035; o.modifiers.new('Normals','WEIGHTED_NORMAL'); return o

def text_obj(body,loc,size,material):
    bpy.ops.object.text_add(location=loc, rotation=(math.radians(67),0,0)); o=bpy.context.object; o.name='3D typography: '+body[:24]; o.data.body=body; o.data.size=size; o.data.extrude=.006; o.data.bevel_depth=.001; o.data.materials.append(material); return o

# Stage and architectural backdrop.
cube('Infinite dark studio floor',(0,0,-.48),(20,20,.4),floor_mat,.02)
# A rim-lit platform creates ground contact and a product-stage horizon.
cylinder('Illuminated product plinth',(0,0,-.16),2.45,.24,navy,96)
cylinder('Cyan plinth inlay',(0,0,-.025),2.36,.025,blue,96)

low=visual.lower(); is_space=any(k in low for k in ('space','planet','orbit','rocket','galaxy','moon'))
is_city=any(k in low for k in ('city','street','urban','building','village','home','house'))
is_data=any(k in low for k in ('data','chart','growth','statistics','market','revenue','number','percent'))
is_device=any(k in low for k in ('phone','smartphone','app','device','product','software','interface'))
is_energy=any(k in low for k in ('energy','battery','power','electric','solar'))

hero=[]
if is_space:
    # A clearly readable orbital system: central planet, illuminated rings and moons.
    planet=sphere('Hero planet',(0,0,1.0),.92,navy); hero.append(planet)
    bpy.ops.mesh.primitive_torus_add(major_radius=1.45, minor_radius=.035, major_segments=96, minor_segments=12, location=(0,0,1.0), rotation=(math.radians(68),0,math.radians(18)))
    ring=bpy.context.object; ring.name='Orbital path'; ring.data.materials.append(blue)
    for i in range(3):
        a=i*math.tau/3+.4; moon=sphere('Orbiting moon',(1.48*math.cos(a),1.48*math.sin(a),1.0+.42*math.sin(a)),.16,gold if i==1 else white,24); hero.append(moon)
    for i in range(24):
        x=random.uniform(-5,5); y=random.uniform(-3,3); z=random.uniform(-2,4)
        sphere('Distant star',(x,y,z),random.uniform(.018,.04),white,12)
elif is_city:
    # Layered architectural skyline with windows, a street grid and luminous wayfinding.
    for row in range(2):
        for col in range(7):
            x=(col-3)*1.15; y=1.45+row*1.4; h=random.uniform(1.0,2.5); w=random.uniform(.62,.9)
            b=cube(f'Architectural tower {row}-{col}',(x,y,h/2-.2),(w,.65,h),navy,.035)
            for floor in range(max(2,int(h*2))):
                for side in (-1,1): cube('Warm lit window',(x+side*w*.23,y-.334,.05+floor*.34),(.13,.025,.12),gold if (floor+col)%4==0 else blue,.012)
    # Road leading to the vanishing point.
    cube('City avenue',(0,-2,-.22),(5.6,5,.14),floor_mat,.02)
    for j in range(6): cube('Lane marker',(0,-4+j*.65,-.12),(.07,.28,.025),gold,.008)
elif is_data:
    # Ordered dimensional chart with axes, ticks and increasing luminous columns.
    cube('Chart baseline',(0,0,.05),(4.8,.12,.08),white,.02); cube('Chart vertical axis',(-2.3,0,1.1),(.08,.12,2.2),white,.02)
    heights=[.5,.8,.72,1.25,1.65,2.05]
    for i,h in enumerate(heights):
        bar=cube(f'Metric bar {i+1}',(-1.65+i*.66,0,h/2+.08),(.42,.48,h),blue if i<4 else gold,.045)
        hero.append(bar)
    for i,label in enumerate(('01','02','03','04','05','06')): text_obj(label,(-1.77+i*.66,-.28,-.25),.15,white)
    text_obj('GROWTH',(-2.1,.22,2.38),.24,white)
elif is_device:
    # Product/device studio: beveled handset, lens, screen glass, UI tiles, orbiting callout nodes.
    body=cube('Hero device chassis',(0,0,1.0),(1.35,.2,2.3),navy,.16); hero.append(body)
    cube('Glass display',(0,-.112,1.02),(1.19,.028,2.08),mat('Deep glass',(.008,.025,.055),.35,.12),.11)
    cube('Screen signal card',(0,-.134,1.3),(.82,.018,.48),blue,.06)
    cube('Screen content line',(-.05,-.147,.7),(.78,.014,.035),white,.015)
    cube('Screen content line',(-.15,-.147,.55),(.58,.014,.025),blue,.01)
    sphere('Camera lens',(.43,-.135,2.0),.075,gold,24)
    for i in range(3):
        a=i*math.tau/3; node=sphere(f'Feature callout node {i}',(1.35*math.cos(a),.15,1.05+.9*math.sin(a)),.105,gold if i==1 else blue,20); hero.append(node)
        bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=.012,depth=1.25,location=(.7*math.cos(a),.08,1.05+.45*math.sin(a))); bpy.context.object.name='Fine callout leader'; bpy.context.object.data.materials.append(blue)
elif is_energy:
    # Energy explainer: battery casing, three cells and charged luminous cap.
    shell=cube('Battery enclosure',(0,0,.78),(1.8,.8,1.75),navy,.14); hero.append(shell)
    cube('Positive terminal',(0,0,1.73),(.6,.54,.16),gold,.04)
    for i in range(3): cube(f'Energy cell {i+1}',((i-1)*.48,-.415,.78),(.34,.04,1.05),blue if i<2 else gold,.035)
    text_obj('POWER',(1.0,-.35,1.35),.23,white)
else:
    # Generic authored product/explainer centerpiece, with labeled concentric rings and mechanical components.
    core=cylinder('Precision-machined core',(0,0,.72),.64,1.18,navy,64); hero.append(core)
    cylinder('Luminous core band',(0,0,.78),.67,.11,blue,64)
    cylinder('Upper crown',(0,0,1.38),.42,.18,gold,48)
    for i in range(8):
        a=i*math.tau/8; loc=(1.28*math.cos(a),1.28*math.sin(a),.55+.22*math.sin(a*2))
        orb=sphere(f'Explainer component {i+1}',loc,.13,blue if i%2==0 else white,20); hero.append(orb)
        bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=.012,depth=1.0,location=(loc[0]*.58,loc[1]*.58,loc[2])); bpy.context.object.name='Radial data link'; bpy.context.object.data.materials.append(gold if i%2==0 else blue)

# Hero title is authored in 3D as a restrained studio label.
label=text_obj(text,( -2.15,-.8,-.31),.19,white); label.data.align_x='LEFT'; label.data.extrude=.002

# Softbox lighting, rim light, and broad shadows.
def area(name,loc,power,color,size,target=(0,0,.7)):
    bpy.ops.object.light_add(type='AREA', location=loc); o=bpy.context.object; o.name=name; o.data.energy=power; o.data.color=color; o.data.shape='DISK'; o.data.size=size; o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
area('Large cool key',(2,-5,6),950,(.62,.82,1),5)
area('Warm edge strip',(-4,1,3.5),1250,(1,.34,.09),3)
area('Top softbox',(1,4,6),1450,(.2,.48,1),4)

# Camera moves on a deterministic shallow arc and looks slightly above center.
bpy.ops.object.camera_add(location=(4.4,-7.8,4.0)); cam=bpy.context.object; cam.name='Product orbit camera'; cam.data.lens=52
scene.camera=cam
for frame,ang in ((1,-.08),(scene.frame_end,.2)):
    cam.location=(7.8*math.sin(ang),-7.8*math.cos(ang),3.6-.25*math.sin(ang*2)); cam.rotation_euler=(Vector((0,0,.72))-cam.location).to_track_quat('-Z','Y').to_euler(); cam.keyframe_insert(data_path='location',frame=frame);cam.keyframe_insert(data_path='rotation_euler',frame=frame)

# Hero objects revolve/spin subtly; chart bars rise from baseline. These keyframes are the actual 3D animation.
for obj in hero:
    for frame,rot in ((1,0),(scene.frame_end,math.radians(24))):
        obj.rotation_euler.z=rot; obj.keyframe_insert(data_path='rotation_euler',frame=frame)
    if is_data and obj.name.startswith('Metric bar'):
        h=obj.dimensions.z; initial=1
        obj.scale.z=.04; obj.location.z=.1; obj.keyframe_insert(data_path='scale',frame=1); obj.keyframe_insert(data_path='location',frame=1)
        obj.scale.z=1; obj.location.z=h/2+.08; obj.keyframe_insert(data_path='scale',frame=scene.frame_end); obj.keyframe_insert(data_path='location',frame=scene.frame_end)
for action in bpy.data.actions:
    for fcurve in getattr(action,'fcurves',[]):
        for kp in fcurve.keyframe_points: kp.interpolation='BEZIER'
scene.frame_set(1)
scene.render.filepath=os.path.join(output,'frame-')
# Use CPU Eevee for predictable local headless rendering without GPU assumptions.
scene.render.image_settings.file_format='PNG'
bpy.ops.render.render(animation=True)
# Encode image sequence into a timeline-ready MP4 via the installed FFmpeg.
pattern=os.path.join(output,'frame-%04d.png')
out=os.path.join(output,'scene.mp4')
ffmpeg=arg('--ffmpeg','ffmpeg')
cmd=[ffmpeg,'-hide_banner','-loglevel','error','-y','-framerate',str(fps),'-i',pattern,'-c:v','libx264','-pix_fmt','yuv420p','-crf','20','-movflags','+faststart',out]
subprocess.run(cmd,check=True)
print('BLENDER_SCENE_OK='+out)

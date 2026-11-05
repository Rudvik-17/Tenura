import os
import math
from PIL import Image, ImageDraw, ImageFilter

def hex_to_rgb(hex_str):
    hex_str = hex_str.lstrip('#')
    return tuple(int(hex_str[i:i+2], 16) for i in (0, 2, 4))

def hex_to_rgba(hex_str, alpha=255):
    r, g, b = hex_to_rgb(hex_str)
    return (r, g, b, alpha)

def interpolate_color(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))

def draw_gradient_polygon(canvas_size, points, color_start, color_end, grad_type='vertical'):
    mask = Image.new('L', canvas_size, 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.polygon(points, fill=255)
    
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    
    poly_img = Image.new('RGBA', canvas_size, (0, 0, 0, 0))
    poly_draw = ImageDraw.Draw(poly_img)
    
    c1 = hex_to_rgb(color_start)
    c2 = hex_to_rgb(color_end)
    
    if grad_type == 'vertical':
        h = max(max_y - min_y, 1)
        for y in range(int(min_y), int(max_y) + 1):
            t = (y - min_y) / h
            col = interpolate_color(c1, c2, t) + (255,)
            poly_draw.line([(min_x, y), (max_x, y)], fill=col)
    elif grad_type == 'iso_diag':
        diag_len = max((max_x - min_x) + (max_y - min_y), 1)
        for y in range(int(min_y), int(max_y) + 1):
            for x in range(int(min_x), int(max_x) + 1):
                proj = ((x - min_x) + (y - min_y)) / diag_len
                t = max(0.0, min(1.0, proj))
                col = interpolate_color(c1, c2, t) + (255,)
                poly_draw.point((x, y), fill=col)
                
    poly_img.putalpha(mask)
    return poly_img

# Exact Tenura UI Color Palette:
# Primary: #4F46E5 / #818CF8 (Precision Indigo)
# Secondary: #0F172A / #94A3B8 (Technical Slate)
# Tertiary: #10B981 / #34D399 (Vibrant Emerald)
# Surface: #0A0B0E / #12131A (Matte Obsidian)

def render_logo_mark(canvas_size=2048, mark_scale=0.72, y_offset=0):
    img = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    s = (canvas_size * mark_scale) / 120.0
    cx = canvas_size / 2.0
    cy = (canvas_size / 2.0) + (y_offset * canvas_size)
    
    def pt(vx, vy):
        return ((vx - 60) * s + cx, (vy - 60) * s + cy)
    
    # 1. Ground Shadow on dark obsidian floor
    shadow_img = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    s_draw = ImageDraw.Draw(shadow_img)
    scx, scy = pt(60, 104)
    srx, sry = 42 * s, 10 * s
    s_draw.ellipse([scx - srx, scy - sry, scx + srx, scy + sry], fill=(0, 0, 0, 175))
    shadow_img = shadow_img.filter(ImageFilter.GaussianBlur(radius=int(12 * s / 10)))
    img = Image.alpha_composite(img, shadow_img)
    
    # 2. Lower Pillar (T Stem) - Bright Vivid Royal Purple
    p_left = [pt(46,58), pt(46,92), pt(60,100), pt(60,66)]
    pillar_left = draw_gradient_polygon((canvas_size, canvas_size), p_left, '#9333EA', '#6B21A8', 'vertical')
    img = Image.alpha_composite(img, pillar_left)
    
    p_right = [pt(60,66), pt(60,100), pt(74,92), pt(74,58)]
    pillar_right = draw_gradient_polygon((canvas_size, canvas_size), p_right, '#6B21A8', '#4C1D95', 'vertical')
    img = Image.alpha_composite(img, pillar_right)
    
    # Glow Balcony Slit / Portal Keyway: UI Emerald (#10B981 / #34D399)
    portal_glow = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    pg_draw = ImageDraw.Draw(portal_glow)
    pcx, pcy = pt(60, 81)
    pr = 10 * s
    pg_draw.ellipse([pcx - pr, pcy - pr, pcx + pr, pcy + pr], fill=hex_to_rgba('#10B981', 140))
    portal_glow = portal_glow.filter(ImageFilter.GaussianBlur(radius=int(6 * s / 10)))
    img = Image.alpha_composite(img, portal_glow)
    
    portal_pts = [pt(56,76), pt(56,86), pt(64,86), pt(64,76)]
    portal_img = draw_gradient_polygon((canvas_size, canvas_size), portal_pts, '#6EE7B7', '#10B981', 'vertical')
    img = Image.alpha_composite(img, portal_img)
    
    # 3. Cantilever Drop Shadow onto pillar
    cant_shadow = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    cs_draw = ImageDraw.Draw(cant_shadow)
    cs_pts = [pt(18,50), pt(60,72), pt(102,50), pt(74,66), pt(46,66)]
    cs_draw.polygon(cs_pts, fill=(0, 0, 0, 150))
    cant_shadow = cant_shadow.filter(ImageFilter.GaussianBlur(radius=int(6 * s / 10)))
    img = Image.alpha_composite(img, cant_shadow)
    
    # 4. Upper Cantilever Penthouse (T Roof bar) - Ultra-Bright Luminous Purple
    head_left_pts = [pt(18,38), pt(60,60), pt(60,72), pt(18,50)]
    head_left = draw_gradient_polygon((canvas_size, canvas_size), head_left_pts, '#A855F7', '#7E22CE', 'vertical')
    img = Image.alpha_composite(img, head_left)
    
    head_right_pts = [pt(60,60), pt(102,38), pt(102,50), pt(60,72)]
    head_right = draw_gradient_polygon((canvas_size, canvas_size), head_right_pts, '#7E22CE', '#4C1D95', 'vertical')
    img = Image.alpha_composite(img, head_right)
    
    # Top Face: Radiant luminous lavender to electric purple
    head_top_pts = [pt(60,16), pt(102,38), pt(60,60), pt(18,38)]
    head_top = draw_gradient_polygon((canvas_size, canvas_size), head_top_pts, '#D8B4FE', '#9333EA', 'iso_diag')
    img = Image.alpha_composite(img, head_top)
    
    # Top Face Details: Crisp Architectural Accent Line & Node
    top_details = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    td_draw = ImageDraw.Draw(top_details)
    
    p_line_start = pt(39, 49)
    p_line_end = pt(81, 27)
    td_draw.line([p_line_start, p_line_end], fill=hex_to_rgba('#FAF5FF', 240), width=max(int(1.8 * s), 2))
    
    # Accent Circle Node at 60, 38
    p_circ = pt(60, 38)
    cr = 4.2 * s
    td_draw.ellipse([p_circ[0] - cr, p_circ[1] - cr, p_circ[0] + cr, p_circ[1] + cr], fill=(255, 255, 255, 255))
    
    # Edge Highlights
    td_draw.line([pt(60,16), pt(102,38)], fill=hex_to_rgba('#E9D5FF', 220), width=max(int(1.4 * s), 1))
    td_draw.line([pt(60,16), pt(18,38)], fill=hex_to_rgba('#FFFFFF', 255), width=max(int(1.6 * s), 1))
    td_draw.line([pt(18,38), pt(60,60)], fill=hex_to_rgba('#C084FC', 200), width=max(int(1.4 * s), 1))
    
    img = Image.alpha_composite(img, top_details)
    return img

def create_background(size=2048, bg_color='#0A0B0E', glow_color='#4F46E5'):
    bg = Image.new('RGBA', (size, size), hex_to_rgba(bg_color, 255))
    
    # Ambient radial glow in center matching UI Precision Indigo
    glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    g_draw = ImageDraw.Draw(glow)
    cx, cy = size / 2.0, size / 2.0
    r = size * 0.38
    g_draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=hex_to_rgba(glow_color, 75))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=int(size * 0.18)))
    
    return Image.alpha_composite(bg, glow)

def generate_all_assets():
    assets_dir = '/Users/rudvikdinesh/Developer/Tenura/assets'
    os.makedirs(assets_dir, exist_ok=True)
    
    print("1. Rendering master high-res UI-matched mark (2048x2048)...")
    master_mark = render_logo_mark(canvas_size=2048, mark_scale=0.74, y_offset=-0.02)
    
    # In-app transparent logo mark: assets/logo.png (512x512)
    print("2. Generating assets/logo.png (512x512)...")
    logo_512 = master_mark.resize((512, 512), Image.Resampling.LANCZOS)
    logo_512.save(os.path.join(assets_dir, 'logo.png'), 'PNG')
    
    # 3. Master App Icon: assets/icon.png and assets/icon-v2.png (1024x1024)
    print("3. Generating assets/icon.png and icon-v2.png (1024x1024)...")
    bg_icon = create_background(size=2048, bg_color='#0A0B0E', glow_color='#4F46E5')
    icon_composite = Image.alpha_composite(bg_icon, master_mark)
    icon_1024 = icon_composite.resize((1024, 1024), Image.Resampling.LANCZOS)
    icon_1024.save(os.path.join(assets_dir, 'icon.png'), 'PNG')
    icon_1024.save(os.path.join(assets_dir, 'icon-v2.png'), 'PNG')
    
    # 4. Android Adaptive Icon: assets/adaptive-icon.png and adaptive-icon-v2.png (1024x1024)
    print("4. Generating assets/adaptive-icon.png and adaptive-icon-v2.png (1024x1024)...")
    adaptive_mark = render_logo_mark(canvas_size=2048, mark_scale=0.55, y_offset=-0.01)
    adaptive_1024 = adaptive_mark.resize((1024, 1024), Image.Resampling.LANCZOS)
    adaptive_1024.save(os.path.join(assets_dir, 'adaptive-icon.png'), 'PNG')
    adaptive_1024.save(os.path.join(assets_dir, 'adaptive-icon-v2.png'), 'PNG')
    
    # 5. Splash Screen Icon: assets/splash-icon.png and splash-v2.png (1024x1024)
    print("5. Generating assets/splash-icon.png and splash-v2.png (1024x1024)...")
    splash_mark = render_logo_mark(canvas_size=2048, mark_scale=0.62, y_offset=-0.02)
    splash_1024 = splash_mark.resize((1024, 1024), Image.Resampling.LANCZOS)
    splash_1024.save(os.path.join(assets_dir, 'splash-icon.png'), 'PNG')
    splash_1024.save(os.path.join(assets_dir, 'splash-v2.png'), 'PNG')
    
    # 6. Web Favicon: assets/favicon.png (48x48)
    print("6. Generating assets/favicon.png (48x48)...")
    fav_mark = render_logo_mark(canvas_size=1024, mark_scale=0.82, y_offset=-0.02)
    fav_48 = fav_mark.resize((48, 48), Image.Resampling.LANCZOS)
    fav_48.save(os.path.join(assets_dir, 'favicon.png'), 'PNG')
    
    print("All UI-matched assets successfully generated in assets/!")

if __name__ == '__main__':
    generate_all_assets()

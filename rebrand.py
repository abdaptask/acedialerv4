import os

def replace_in_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        return False
    
    new_content = content
    # Do straight string replacements for guarantees
    replacements = [
        ('ACE Dialer', 'AptLink'),
        ('ACE_DIALER', 'APTLINK'),
        ('ACE_Dialer', 'AptLink'),
        ('ace-dialer', 'aptlink'),
        ('ace_dialer', 'aptlink'),
        ('ace_status', 'aptlink_status'),
        ('ace_token', 'aptlink_token'),
        ('ace_speaker', 'aptlink_speaker'),
        ('ace_mic', 'aptlink_mic'),
        ('ace_ring', 'aptlink_ring'),
        ('ace_', 'aptlink_'),
        ('ACE ', 'AptLink '),
        ('ACE-', 'AptLink-'),
    ]
    
    for old, new in replacements:
        new_content = new_content.replace(old, new)
        
    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        return True
    return False

directories_to_scan = [
    'apps',
    'packages',
    'README.md',
    'USER_GUIDE.md',
    'CLAUDE.md',
    'ACE_DIALER_TODO.md',
    'TODO.md'
]

changed_files = 0
for item in directories_to_scan:
    if os.path.isfile(item):
        if replace_in_file(item):
            changed_files += 1
    else:
        for root, dirs, files in os.walk(item):
            # Skip node_modules and build folders
            if 'node_modules' in root or 'dist' in root or 'build' in root or '.git' in root or 'release' in root:
                continue
            for file in files:
                if file.endswith(('.ts', '.tsx', '.json', '.html', '.css', '.md', '.env', '.prisma')):
                    filepath = os.path.join(root, file)
                    if replace_in_file(filepath):
                        changed_files += 1

print(f"Rebranded {changed_files} files successfully!")

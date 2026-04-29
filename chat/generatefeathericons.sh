#!/bin/bash

# Check if the target directory is provided as an argument
if [ -z "$1" ]; then
    echo "Usage: $0 <target_directory>"
    exit 1
fi

# Define the target directory and output file
target_directory="$1"
output_file="./src/feather.js"

# Start the feather.js file with a comment
echo "// feather.js" > $output_file

# Iterate over all .svg files in the target directory
for svg_file in "$target_directory"/*.svg; do
    # Check if there are no .svg files in the directory
    if [ ! -e "$svg_file" ]; then
        echo "No .svg files found in the directory."
        exit 1
    fi
    
    # Extract the base name of the file (without extension)
    base_name=$(basename "$svg_file" .svg)
    
    # Extract the inner contents of the SVG file
    inner_content=$(sed -n 's/.*<svg[^>]*>\(.*\)<\/svg>.*/\1/p' "$svg_file")
    
    # Convert the base name to camel case for the variable name
    var_name=$(echo "$base_name" | awk -F'-' '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2))}1' OFS='')
    
    # Append the extracted content to the feather.js file
    echo "export const fe$var_name = \`$inner_content\`;" >> $output_file
done

echo "feather.js file has been created successfully."
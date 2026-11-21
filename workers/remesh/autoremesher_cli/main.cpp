// Headless command-line front end for the AutoRemesher core library
// (https://github.com/huxingyi/autoremesher, MIT). Upstream ships the library
// only inside a Qt desktop app; the core in src/AutoRemesher has no Qt
// dependency, so this file drives it directly from an OBJ in to an OBJ out.
//
//   autoremesher-cli -i in.obj -o out.obj -t <target triangles>
//                    [--hard-surface] [--sharp <deg>] [--adaptivity <0..1>]
//                    [--anisotropy <0..1>] [--smooth-normal <deg>]
//
// The input is triangulated on read (polygons are fan-split). The output keeps
// AutoRemesher's quad-dominant faces as written: quads stay quads.
//
// Exit status: 0 on success, 2 for bad arguments or unreadable input, 3 when the
// remesh itself failed, 4 when the output could not be written.

#include <AutoRemesher/AutoRemesher>
#include <AutoRemesher/Vector3>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace {

void usage()
{
    std::cerr << "usage: autoremesher-cli -i in.obj -o out.obj -t <target triangles>\n"
                 "                        [--hard-surface] [--sharp <deg>] [--adaptivity <0..1>]\n"
                 "                        [--anisotropy <0..1>] [--smooth-normal <deg>]\n";
}

bool readObj(const std::string& path,
    std::vector<AutoRemesher::Vector3>& vertices,
    std::vector<std::vector<size_t>>& triangles)
{
    std::ifstream in(path);
    if (!in)
        return false;
    std::string line;
    while (std::getline(in, line)) {
        if (line.size() < 2)
            continue;
        if (line[0] == 'v' && line[1] == ' ') {
            std::istringstream ss(line.substr(2));
            double x = 0, y = 0, z = 0;
            ss >> x >> y >> z;
            vertices.emplace_back(x, y, z);
        } else if (line[0] == 'f' && line[1] == ' ') {
            std::istringstream ss(line.substr(2));
            std::vector<size_t> face;
            std::string token;
            while (ss >> token) {
                // "7", "7/2", "7//3", "7/2/3": the vertex index is the first field.
                long index = std::strtol(token.c_str(), nullptr, 10);
                if (index < 0)
                    index = static_cast<long>(vertices.size()) + index + 1;
                if (index <= 0 || static_cast<size_t>(index) > vertices.size())
                    return false;
                face.push_back(static_cast<size_t>(index - 1));
            }
            for (size_t i = 1; i + 1 < face.size(); ++i)
                triangles.push_back({ face[0], face[i], face[i + 1] });
        }
    }
    return !vertices.empty() && !triangles.empty();
}

bool writeObj(const std::string& path,
    const std::vector<AutoRemesher::Vector3>& vertices,
    const std::vector<std::vector<size_t>>& faces)
{
    FILE* out = std::fopen(path.c_str(), "w");
    if (nullptr == out)
        return false;
    for (const auto& v : vertices)
        std::fprintf(out, "v %.6f %.6f %.6f\n", v.x(), v.y(), v.z());
    for (const auto& face : faces) {
        std::fputc('f', out);
        for (size_t index : face)
            std::fprintf(out, " %zu", index + 1);
        std::fputc('\n', out);
    }
    return 0 == std::fclose(out);
}

void reportProgress(void*, float progress, const char* status)
{
    if (nullptr != status)
        std::fprintf(stderr, "progress %.3f %s\n", progress, status);
}

bool parseDouble(const char* text, double& value)
{
    char* end = nullptr;
    value = std::strtod(text, &end);
    return end != text && *end == '\0';
}

} // namespace

int main(int argc, char** argv)
{
    std::string inputPath;
    std::string outputPath;
    long target = 0;
    bool hardSurface = false;
    double sharpDegrees = AutoRemesher::AutoRemesher::m_defaultSharpEdgeDegrees;
    double adaptivity = 1.0;
    double anisotropy = 1.0;
    double smoothNormalDegrees = 0.0;

    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        const bool hasValue = i + 1 < argc;
        if (arg == "-i" && hasValue) {
            inputPath = argv[++i];
        } else if (arg == "-o" && hasValue) {
            outputPath = argv[++i];
        } else if (arg == "-t" && hasValue) {
            target = std::strtol(argv[++i], nullptr, 10);
        } else if (arg == "--hard-surface") {
            hardSurface = true;
        } else if (arg == "--sharp" && hasValue) {
            if (!parseDouble(argv[++i], sharpDegrees)) {
                usage();
                return 2;
            }
        } else if (arg == "--adaptivity" && hasValue) {
            if (!parseDouble(argv[++i], adaptivity)) {
                usage();
                return 2;
            }
        } else if (arg == "--anisotropy" && hasValue) {
            if (!parseDouble(argv[++i], anisotropy)) {
                usage();
                return 2;
            }
        } else if (arg == "--smooth-normal" && hasValue) {
            if (!parseDouble(argv[++i], smoothNormalDegrees)) {
                usage();
                return 2;
            }
        } else {
            usage();
            return 2;
        }
    }
    if (inputPath.empty() || outputPath.empty() || target <= 0) {
        usage();
        return 2;
    }

    std::vector<AutoRemesher::Vector3> vertices;
    std::vector<std::vector<size_t>> triangles;
    if (!readObj(inputPath, vertices, triangles)) {
        std::cerr << "could not read a triangle mesh from " << inputPath << std::endl;
        return 2;
    }

    AutoRemesher::AutoRemesher remesher(vertices, triangles);
    remesher.setTargetTriangleCount(static_cast<size_t>(target));
    remesher.setModelType(hardSurface ? AutoRemesher::ModelType::HardSurface
                                      : AutoRemesher::ModelType::Organic);
    remesher.setSharpEdgeDegrees(sharpDegrees);
    remesher.setGradientAdaptivity(adaptivity);
    remesher.setAnisotropy(anisotropy);
    remesher.setSmoothNormalDegrees(smoothNormalDegrees);
    remesher.setProgressHandler(reportProgress);
    if (!remesher.remesh() || remesher.remeshedQuads().empty()) {
        std::cerr << "autoremesher produced no faces" << std::endl;
        return 3;
    }
    for (const auto& line : remesher.phaseReport())
        std::cerr << line << std::endl;

    if (!writeObj(outputPath, remesher.remeshedVertices(), remesher.remeshedQuads())) {
        std::cerr << "could not write " << outputPath << std::endl;
        return 4;
    }
    return 0;
}
